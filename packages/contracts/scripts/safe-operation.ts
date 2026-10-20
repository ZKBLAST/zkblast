import {
  concatHex,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const safeOperationAbi = parseAbi([
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)",
]);

const types = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

function owner(name: string) {
  const value = process.env[name]?.trim();
  if (!value || !/^0x[\da-f]{64}$/iu.test(value))
    throw new Error(`Missing or invalid ${name}`);
  return privateKeyToAccount(value as Hex);
}

export async function prepareSafeOperation(
  client: PublicClient,
  input: {
    chainId: number;
    safe: Address;
    to: Address;
    data: Hex;
    relayer: Address | Account;
  },
) {
  const signers = [
    owner("GOVERNANCE_PRIVATE_KEY"),
    owner("UPGRADER_PRIVATE_KEY"),
  ].sort((a, b) =>
    a.address.toLowerCase().localeCompare(b.address.toLowerCase()),
  );
  const [first, second] = signers;
  if (!first || !second || first.address === second.address)
    throw new Error("Two distinct Safe signers required");
  const [owners, threshold, nonce] = await Promise.all([
    client.readContract({
      address: input.safe,
      abi: safeOperationAbi,
      functionName: "getOwners",
    }),
    client.readContract({
      address: input.safe,
      abi: safeOperationAbi,
      functionName: "getThreshold",
    }),
    client.readContract({
      address: input.safe,
      abi: safeOperationAbi,
      functionName: "nonce",
    }),
  ]);
  if (
    threshold !== 2n ||
    !signers.every((signer) =>
      owners.some((address) => getAddress(address) === signer.address),
    )
  )
    throw new Error("Safe owner or threshold mismatch");
  const message = {
    to: input.to,
    value: 0n,
    data: input.data,
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: zeroAddress,
    refundReceiver: zeroAddress,
    nonce,
  } as const;
  const domain = { chainId: input.chainId, verifyingContract: input.safe };
  const hash = hashTypedData({ domain, types, primaryType: "SafeTx", message });
  const base = [
    message.to,
    0n,
    message.data,
    0,
    0n,
    0n,
    0n,
    zeroAddress,
    zeroAddress,
  ] as const;
  const onchain = await client.readContract({
    address: input.safe,
    abi: safeOperationAbi,
    functionName: "getTransactionHash",
    args: [...base, nonce],
  });
  if (hash !== onchain) throw new Error("Safe EIP712 hash mismatch");
  const signatures = concatHex(
    await Promise.all(
      signers.map((account) =>
        account.signTypedData({
          domain,
          types,
          primaryType: "SafeTx",
          message,
        }),
      ),
    ),
  );
  const args = [...base, signatures] as const;
  const simulation = await client.simulateContract({
    account: input.relayer,
    address: input.safe,
    abi: safeOperationAbi,
    functionName: "execTransaction",
    args,
  });
  if (!simulation.result) throw new Error("Safe operation simulation failed");
  return {
    nonce,
    hash,
    to: input.safe,
    data: encodeFunctionData({
      abi: safeOperationAbi,
      functionName: "execTransaction",
      args,
    }),
  };
}
