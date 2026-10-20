import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  artifact,
  check,
  readJson,
  receiptRecord,
  runtime,
  saveJson,
} from "./shielded-mainnet-runtime.js";
import {
  acceptanceNote,
  saveNote,
  withdrawalPayload,
} from "./shielded-mainnet-proof.js";

type Deployment = {
  chainId: number;
  verifier: Address;
  shielded: {
    vault: Address;
    stateRegistry: Address;
    fieldHasher: Address;
    assets: readonly { address: Address }[];
  };
};
type Payload = Awaited<ReturnType<typeof withdrawalPayload>>;
const reportPath = "deployments/mainnet/shielded-beta-acceptance.json";
const payloadPath = "deployments/mainnet/shielded-beta-withdrawal.private.json";
const statePath = "deployments/mainnet/shielded-beta-acceptance.private.json";

async function main() {
  const state = await runtime();
  const { client, account, send, journal } = state;
  const deployment = await readJson<Deployment>(
    "deployments/mainnet/shielded-beta.json",
  );
  check(deployment.chainId === 4663, "Deployment chain mismatch");
  const { vault, stateRegistry, fieldHasher } = deployment.shielded;
  const asset = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
  check(
    deployment.shielded.assets.length === 1 &&
      getAddress(deployment.shielded.assets[0]!.address) === asset,
    "Only approved USDG acceptance is permitted",
  );
  try {
    const completed = await readJson<{
      status: string;
      vault: Address;
      withdrawalTransaction: Hex;
    }>(reportPath);
    check(
      completed.status === "passed" && getAddress(completed.vault) === vault,
      "Acceptance report mismatch",
    );
    const receipt = await client.getTransactionReceipt({
      hash: completed.withdrawalTransaction,
    });
    check(
      receipt.status === "success",
      "Completed withdrawal is not canonical/successful",
    );
    console.log(
      JSON.stringify({
        acceptance: "already-complete",
        vault,
        additionalTransactions: 0,
      }),
    );
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const vaultAbi = (await artifact("ZKBlastVault")).abi;
  const registryAbi = (await artifact("ShieldedStateRegistry")).abi;
  const readVault = (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({ address: vault, abi: vaultAbi, functionName, args });
  const tokenBalance = () =>
    client.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
  const decimals = await client.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "decimals",
  });
  check(decimals === 6, "USDG precision changed");
  let before: { balanceRaw: string };
  try {
    before = await readJson(statePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    check(
      (await readVault("nextLeafIndex")) === 0n,
      "Acceptance requires an untouched vault",
    );
    before = { balanceRaw: String(await tokenBalance()) };
    check(
      BigInt(before.balanceRaw) >= 1_000_000n,
      "Insufficient USDG for approved acceptance",
    );
    await saveJson(statePath, before);
  }
  const siblings: Hex[] = [];
  let zero = toHex(1n, { size: 32 });
  const hasherAbi = (await artifact("Poseidon2FieldHasher")).abi;
  for (let level = 0; level < 32; level++) {
    siblings.push(zero);
    zero = (await client.readContract({
      address: fieldHasher,
      abi: hasherAbi,
      functionName: "hashMerkleNode",
      args: [BigInt(level), zero, zero],
    })) as Hex;
  }
  let note = await acceptanceNote(vault, asset, siblings);
  let payload: Payload;
  if (journal.steps.withdrawBetaAcceptance)
    payload = await readJson(payloadPath);
  else {
    payload = await withdrawalPayload(note, siblings, account.address);
    await saveJson(payloadPath, payload);
  }
  const inputs = payload.inputs.map(BigInt);
  const verified = await client.readContract({
    address: deployment.verifier,
    abi: (await artifact("ZKBlastBetaWithdrawVerifier")).abi,
    functionName: "verify",
    args: [payload.encoded, inputs],
  });
  check(
    verified === true,
    "Deployed verifier rejected local proof; do not deposit",
  );
  if (!journal.steps.depositBetaAcceptance) {
    check(
      (await readVault("nextLeafIndex")) === 0n,
      "Vault changed before acceptance deposit",
    );
    const allowance = await client.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, vault],
    });
    if (allowance !== 0n && allowance !== 1_000_000n)
      await send("resetBetaAcceptanceAllowance", {
        to: asset,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [vault, 0n],
        }),
      });
    if (allowance !== 1_000_000n)
      await send("approveBetaAcceptance", {
        to: asset,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [vault, 1_000_000n],
        }),
      });
  }
  const deposit = await send("depositBetaAcceptance", {
    to: vault,
    data: encodeFunctionData({
      abi: vaultAbi,
      functionName: "deposit",
      args: [asset, 1_000_000n, toHex(BigInt(note.commitment), { size: 32 })],
    }),
  });
  note = {
    ...note,
    status: "unspent",
    leafIndex: 0,
    transactionHash: deposit.transactionHash,
  };
  await saveNote(note);
  check(
    (await readVault("root")) === payload.root,
    "Onchain root mismatch; preserve backup and stop",
  );
  check(
    (await client.readContract({
      address: stateRegistry,
      abi: registryAbi,
      functionName: "isKnownRoot",
      args: [vault, 1n, payload.root],
    })) === true,
    "Root not registered",
  );
  const withdrawal = await send("withdrawBetaAcceptance", {
    to: vault,
    data: encodeFunctionData({
      abi: vaultAbi,
      functionName: "withdraw",
      args: [payload.encoded, inputs],
    }),
  });
  check(
    (await client.readContract({
      address: stateRegistry,
      abi: registryAbi,
      functionName: "isNullifierSpent",
      args: [vault, 1n, payload.nullifier],
    })) === true,
    "Nullifier not consumed",
  );
  check(
    (await readVault("liabilityRaw", [asset])) === 0n,
    "Acceptance left outstanding USDG liability",
  );
  const balance = await tokenBalance();
  check(
    balance >= BigInt(before.balanceRaw),
    "USDG was not restored to the deployer",
  );
  await saveNote({ ...note, status: "spent" });
  await saveJson(reportPath, {
    schemaVersion: 1,
    environment: "mainnet",
    chainId: 4663,
    launchMode: "experimental-single-operator",
    independentReview: false,
    status: "passed",
    vault,
    asset,
    amountRaw: "1000000",
    encryptedBackupRestore: true,
    localProofVerified: true,
    deployedVerifierVerified: true,
    depositTransaction: deposit.transactionHash,
    withdrawalTransaction: withdrawal.transactionHash,
    transactions: {
      deposit: receiptRecord(deposit),
      withdrawal: receiptRecord(withdrawal),
    },
    deployerBalanceBeforeRaw: before.balanceRaw,
    deployerBalanceAfterRaw: String(balance),
    totalDeploymentConfigurationAcceptanceGasFeeWei: String(state.spent()),
    browserSignedAcceptance: false,
    railwayRelease: false,
  });
  console.log(
    JSON.stringify({
      acceptance: "passed",
      chainId: 4663,
      vault,
      amountUsdg: "1",
      depositTransaction: deposit.transactionHash,
      withdrawalTransaction: withdrawal.transactionHash,
      totalGasFeeWei: String(state.spent()),
      browserSignedAcceptance: false,
    }),
  );
}
main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(
      error instanceof Error &&
        !error.message.includes("http") &&
        error.message.length < 180
        ? error.message
        : "MAINNET_SHIELDED_ACCEPTANCE_FAILED; preserve private encrypted recovery artifacts",
    );
    process.exit(1);
  },
);
