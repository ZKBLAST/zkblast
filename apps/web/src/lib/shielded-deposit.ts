import { erc20Abi, zkBlastVaultAbi } from "@zkblast/abi";
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { commitmentHex } from "./note-circuit";
import type { ShieldedNoteV1 } from "./notecrypto";
import { waitForReceipt, type PreparedTransaction } from "./swap-flow";
import type { EthereumProvider } from "@/types/application";

type DepositState =
  | "switching-network"
  | "resetting-allowance"
  | "approving"
  | "depositing"
  | "confirmed";
type ReceiptLog = Readonly<{
  address: Address;
  data: Hex;
  topics: readonly Hex[];
}>;
type Receipt = Readonly<{
  transactionHash: Hex;
  status: Hex;
  logs?: readonly ReceiptLog[];
}>;

const transaction = (to: Address, data: Hex): PreparedTransaction => ({
  to,
  data,
  value: "0x0",
});

async function send(
  provider: EthereumProvider,
  sender: Address,
  prepared: PreparedTransaction,
): Promise<Hex> {
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ from: sender, ...prepared }],
  }) as Promise<Hex>;
}

async function currentAllowance(
  provider: EthereumProvider,
  owner: Address,
  token: Address,
  vault: Address,
): Promise<bigint> {
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "allowance",
    args: [owner, vault],
  });
  const result = (await provider.request({
    method: "eth_call",
    params: [{ to: token, data }, "latest"],
  })) as Hex;
  return decodeFunctionResult({
    abi: erc20Abi,
    functionName: "allowance",
    data: result,
  });
}

async function submitAndWait(
  provider: EthereumProvider,
  sender: Address,
  prepared: PreparedTransaction,
  chainId: number,
): Promise<Receipt> {
  const hash = await send(provider, sender, prepared);
  return waitForReceipt(provider, hash, 40, {
    chainId,
    action: prepared.data.startsWith("0x095ea7b3")
      ? "Token approval"
      : "Shielded deposit",
  }) as Promise<Receipt>;
}

export async function executeShieldedDeposit(
  provider: EthereumProvider,
  sender: Address,
  note: ShieldedNoteV1,
  onState: (state: DepositState) => void,
): Promise<ShieldedNoteV1> {
  if (note.status !== "prepared") throw new Error("NOTE_ALREADY_SUBMITTED");
  const walletChain = (await provider.request({
    method: "eth_chainId",
  })) as string;
  if (Number.parseInt(walletChain, 16) !== note.chainId) {
    onState("switching-network");
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${note.chainId.toString(16)}` }],
    });
  }
  const token = note.assetAddress;
  const vault = note.vaultAddress;
  const amount = BigInt(note.amountRaw);
  const allowance = await currentAllowance(provider, sender, token, vault);
  if (allowance !== 0n && allowance !== amount) {
    onState("resetting-allowance");
    await submitAndWait(
      provider,
      sender,
      transaction(
        token,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [vault, 0n],
        }),
      ),
      note.chainId,
    );
  }
  if (allowance !== amount) {
    onState("approving");
    await submitAndWait(
      provider,
      sender,
      transaction(
        token,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [vault, amount],
        }),
      ),
      note.chainId,
    );
  }
  onState("depositing");
  const receipt = await submitAndWait(
    provider,
    sender,
    transaction(
      vault,
      encodeFunctionData({
        abi: zkBlastVaultAbi,
        functionName: "deposit",
        args: [token, amount, commitmentHex(note.commitment)],
      }),
    ),
    note.chainId,
  );
  const event = receipt.logs?.flatMap((log) => {
    if (log.address.toLowerCase() !== vault.toLowerCase()) return [];
    try {
      const decoded = decodeEventLog({
        abi: zkBlastVaultAbi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
        eventName: "CommitmentDeposited",
      });
      return [decoded.args];
    } catch {
      return [];
    }
  })[0];
  if (
    !event ||
    event.commitment.toLowerCase() !==
      commitmentHex(note.commitment).toLowerCase()
  )
    throw new Error("DEPOSIT_EVENT_MISSING");
  onState("confirmed");
  return {
    ...note,
    leafIndex: Number(event.leafIndex),
    transactionHash: receipt.transactionHash,
    status: "unspent",
  };
}
