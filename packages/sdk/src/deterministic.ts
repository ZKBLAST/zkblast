import { getChainDescriptor } from "@zkblast/config";
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

export function launchIdentifier(input: Readonly<{
  chainId: number;
  factory: Address;
  creator: Address;
  templateId: bigint;
  salt: Hex;
}>): Hex {
  getChainDescriptor(input.chainId);
  if (input.templateId < 0n) throw new Error("TEMPLATE_ID_INVALID");
  if (!/^0x[\da-f]{64}$/iu.test(input.salt)) throw new Error("SALT_INVALID");
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        BigInt(input.chainId),
        getAddress(input.factory),
        getAddress(input.creator),
        input.templateId,
        input.salt,
      ],
    ),
  );
}

export function derivedLaunchCreate2Salt(
  launchId: Hex,
  kind: "TOKEN" | "VIRTUAL_POOL",
): Hex {
  if (!/^0x[\da-f]{64}$/iu.test(launchId))
    throw new Error("LAUNCH_ID_INVALID");
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "string" }],
      [launchId, kind],
    ),
  );
}
