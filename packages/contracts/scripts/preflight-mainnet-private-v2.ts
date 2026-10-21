import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  createPublicClient,
  http,
  getAddress,
  parseAbi,
  decodeFunctionData,
  keccak256,
  formatEther,
  type Address,
  type Hex,
} from "viem";
import { normalizeSafeOwners } from "./private-v2-safe-owners.js";

// Read-only live RPC. No signing key, wallet client, transfer, or broadcast method.
const root = path.resolve(import.meta.dirname, "../../..");
const name = process.argv[2];
function check(value: unknown, code: string): asserts value {
  if (!value) throw new Error(code);
}
check(
  /^candidate-[\w-]+$/u.test(name ?? ""),
  "EXPLICIT_MAINNET_CANDIDATE_REQUIRED",
);
const directory = path.join(root, "packages/circuits/target/v2-mainnet", name!);
const readJson = async (file: string) =>
  JSON.parse(await readFile(file, "utf8"));
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const safeAbi = parseAbi([
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getTransactionHash(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,uint256) view returns (bytes32)",
  "function approveHash(bytes32)",
  "function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) returns (bool)",
]);
type Transaction = {
  name: string;
  actor: Address;
  nonce: number;
  gasBudget: string;
  data: Hex;
  calldataHash: Hex;
  to: Address | null;
};
async function main() {
  check(
    process.env.APP_ENV === "mainnet" &&
      process.env.CHAIN_ID === "4663" &&
      process.env.RPC_URL,
    "MAINNET_RUNTIME_REQUIRED",
  );
  const manifestBytes = await readFile(
    path.join(root, "deployments/mainnet/manifest.json"),
  );
  const manifest = JSON.parse(manifestBytes.toString());
  const candidateBytes = await readFile(path.join(directory, "candidate.json"));
  const candidate = JSON.parse(candidateBytes.toString());
  const previous = await readJson(
    path.join(directory, "mainnet-rehearsal.json"),
  );
  const proposalBytes = await readFile(
    path.join(directory, "mainnet-proposal.json"),
  );
  const proposal = JSON.parse(proposalBytes.toString());
  const transactions = proposal.transactions as Transaction[];
  check(
    manifest.environment === "mainnet" &&
      manifest.chainId === 4663 &&
      proposal.environment === "mainnet" &&
      proposal.chainId === 4663 &&
      previous.deploymentVerifiedOnForkOnly &&
      previous.v1ForkStateUnchanged &&
      previous.candidateSha256 === sha(candidateBytes) &&
      proposal.candidateSha256 === sha(candidateBytes) &&
      proposal.broadcastAllowed === false &&
      transactions.length === 27,
    "VERIFIED_UNAPPROVED_PROPOSAL_REQUIRED",
  );
  for (const tx of transactions)
    check(keccak256(tx.data) === tx.calldataHash, "PROPOSAL_CALLDATA_CHANGED");
  for (const kind of ["action", "fund"]) {
    const meta = candidate.artifacts[kind];
    for (const [file, hash] of [
      [`${kind}.wasm`, meta.wasmSha256],
      [`${kind}-mainnet-candidate.zkey`, meta.provingKeySha256],
      [`${kind}-vkey.json`, meta.verificationKeySha256],
    ])
      check(
        sha(await readFile(path.join(directory, file))) === hash,
        "CANDIDATE_ARTIFACT_CHANGED",
      );
  }
  const client = createPublicClient({
    cacheTime: 0,
    transport: http(process.env.RPC_URL, { timeout: 20000, retryCount: 0 }),
  });
  check((await client.getChainId()) === 4663, "RPC_CHAIN_MISMATCH");
  const block = await client.getBlock();
  const blockNumber = block.number;
  const gasPrice = await client.getGasPrice();
  const maxFeePerGas = gasPrice * 2n;
  const safe = getAddress(manifest.roles.defaultAdmin);
  const owners = normalizeSafeOwners(
    await client.readContract({
      address: safe,
      abi: safeAbi,
      functionName: "getOwners",
      blockNumber,
    }),
  );
  const threshold = await client.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "getThreshold",
    blockNumber,
  });
  const safeNonce = await client.readContract({
    address: safe,
    abi: safeAbi,
    functionName: "nonce",
    blockNumber,
  });
  check(
    threshold === 2n &&
      JSON.stringify(owners) === JSON.stringify(previous.governance.owners) &&
      safe.toLowerCase() === previous.governance.safe.toLowerCase(),
    "SAFE_GOVERNANCE_CHANGED",
  );
  const safeEvidence = await readJson(
    path.join(root, "deployments/mainnet/safe.json"),
  );
  const governance = await readJson(
    path.join(root, "deployments/mainnet/governance.json"),
  );
  const safeCode = await client.getCode({ address: safe, blockNumber });
  const timelock = getAddress(manifest.roles.upgrader);
  const timelockCode = await client.getCode({ address: timelock, blockNumber });
  check(
    safeCode &&
      keccak256(safeCode) === safeEvidence.safe.runtimeBytecodeHash &&
      timelockCode &&
      keccak256(timelockCode) === governance.deployedRuntimeBytecodeHash,
    "GOVERNANCE_RUNTIME_CHANGED",
  );
  check(
    (await client.readContract({
      address: timelock,
      abi: parseAbi(["function getMinDelay() view returns (uint256)"]),
      functionName: "getMinDelay",
      blockNumber,
    })) === 300n,
    "TIMELOCK_DELAY_CHANGED",
  );
  const refreshReasons: string[] = [];
  const actors = [];
  for (const actor of [...new Set(transactions.map((tx) => tx.actor))]) {
    const planned = transactions.filter((tx) => tx.actor === actor);
    const [confirmedNonce, pendingNonce, balance] = await Promise.all([
      client.getTransactionCount({ address: actor, blockNumber }),
      client.getTransactionCount({ address: actor, blockTag: "pending" }),
      client.getBalance({ address: actor, blockNumber }),
    ]);
    if (pendingNonce !== confirmedNonce)
      refreshReasons.push(`PENDING_TRANSACTION:${actor}`);
    if (confirmedNonce !== planned[0]!.nonce)
      refreshReasons.push(`ACTOR_NONCE_CHANGED:${actor}`);
    const gasBudget = planned.reduce((n, tx) => n + BigInt(tx.gasBudget), 0n);
    const required = gasBudget * maxFeePerGas;
    const deficit = required > balance ? required - balance : 0n;
    const practicalTopUp = deficit
      ? ((deficit + 9_999_999_999_999n) / 10_000_000_000_000n) *
        10_000_000_000_000n
      : 0n;
    actors.push({
      actor,
      role:
        actor.toLowerCase() === manifest.deployerAddress.toLowerCase()
          ? "deployer"
          : actor.toLowerCase() === owners[0]?.toLowerCase()
            ? "safe-executor-owner"
            : "safe-approver-owner",
      transactionCount: planned.length,
      expectedFirstNonce: planned[0]!.nonce,
      confirmedNonce,
      pendingNonce,
      balanceWei: String(balance),
      balanceEth: formatEther(balance),
      gasBudget: String(gasBudget),
      feeReserveWei: String(required),
      feeReserveEth: formatEther(required),
      deficitWei: String(deficit),
      deficitEth: formatEther(deficit),
      practicalTopUpEth: formatEther(practicalTopUp),
      fundedAtQuotedReserve: deficit === 0n,
    });
  }
  // Safe nonce is implicit in execTransaction: rederive every approval hash against live nonce.
  const safeOperations = [];
  for (let i = 7; i < transactions.length; i += 2) {
    const approval = transactions[i]!;
    const execution = transactions[i + 1]!;
    check(
      approval.to?.toLowerCase() === safe.toLowerCase() &&
        execution.to?.toLowerCase() === safe.toLowerCase(),
      "SAFE_DESTINATION_CHANGED",
    );
    const decoded = decodeFunctionData({ abi: safeAbi, data: execution.data });
    const approve = decodeFunctionData({ abi: safeAbi, data: approval.data });
    check(
      decoded.functionName === "execTransaction" &&
        approve.functionName === "approveHash",
      "SAFE_OPERATION_CHANGED",
    );
    const [
      to,
      value,
      data,
      operation,
      safeTxGas,
      baseGas,
      gasPrice,
      gasToken,
      refundReceiver,
    ] = decoded.args;
    check(
      value === 0n &&
        operation === 0 &&
        to.toLowerCase() ===
          previous.predicted.PrivateVaultV2Proxy.toLowerCase(),
      "SAFE_SCOPE_CHANGED",
    );
    const nonce = safeNonce + BigInt((i - 7) / 2);
    const liveHash = await client.readContract({
      address: safe,
      abi: safeAbi,
      functionName: "getTransactionHash",
      args: [
        to,
        value,
        data,
        operation,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        nonce,
      ],
      blockNumber,
    });
    const matches = liveHash.toLowerCase() === approve.args[0].toLowerCase();
    safeOperations.push({
      name: execution.name,
      safeNonce: String(nonce),
      approvalHashMatches: matches,
    });
    if (!matches)
      refreshReasons.push(`SAFE_NONCE_OR_HASH_CHANGED:${execution.name}`);
  }
  for (const address of Object.values(previous.predicted) as Address[])
    if (await client.getCode({ address, blockNumber }))
      refreshReasons.push(`PREDICTED_ADDRESS_OCCUPIED:${address}`);
  const gasBudget = transactions.reduce(
    (n, tx) => n + BigInt(tx.gasBudget),
    0n,
  );
  check(gasBudget === BigInt(previous.gasBudget), "GAS_PLAN_CHANGED");
  const basis = BigInt(previous.conservativeGasBasis);
  const report = {
    environment: "mainnet",
    chainId: 4663,
    generatedAt: new Date().toISOString(),
    snapshotBlock: String(blockNumber),
    snapshotBlockHash: block.hash,
    snapshotBlockTimeUtc: new Date(
      Number(block.timestamp) * 1000,
    ).toISOString(),
    candidate: name,
    candidateSha256: sha(candidateBytes),
    proposalSha256: sha(proposalBytes),
    activeManifestSha256: sha(manifestBytes),
    gasBasisSource:
      "Previously successful 27-transaction fork rehearsal; no repeated key generation or lifecycle suite",
    gasBasisBlock: previous.sourceBlock,
    gasBasis: String(basis),
    gasBudget: String(gasBudget),
    gasPriceWei: String(gasPrice),
    maxFeePerGasWei: String(maxFeePerGas),
    basisFeeEth: formatEther(basis * gasPrice),
    feeAtGasBudgetAndCurrentPriceEth: formatEther(gasBudget * gasPrice),
    recommendedFeeReserveEth: formatEther(gasBudget * maxFeePerGas),
    safe,
    safeNonce: String(safeNonce),
    threshold: String(threshold),
    owners,
    timelock,
    timelockDelaySeconds: 300,
    actors,
    safeOperations,
    proposalStillMatchesNoncesAndSafeHashes: refreshReasons.length === 0,
    refreshReasons,
    fundingComplete: actors.every((actor) => actor.fundedAtQuotedReserve),
    broadcastApproved: false,
    liveTransactionsBroadcast: 0,
    railwayDeployed: false,
    caveats: [
      "Refresh quote only; gas units from the prior verified fork and not a new live full-plan simulation",
      "Live RPC gas coverage was 7/27; Safe data-fee overhead and fee movement may exceed this estimate",
      "No top-up transaction fee is included; the sending wallet also pays its transfer gas",
      "Top-up does not grant broadcast authority; explicit bounded mainnet approval is still required",
      "No old vault/note access, database or active manifest mutation",
    ],
  };
  const filename = `mainnet-preflight-${report.generatedAt.replace(/[:.]/gu, "-")}.json`;
  await writeFile(
    path.join(directory, filename),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify({ report: filename, ...report }, null, 2));
}
main().catch((error) => {
  console.error(
    error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "MAINNET_READ_ONLY_PREFLIGHT_FAILED",
  );
  process.exitCode = 1;
});
