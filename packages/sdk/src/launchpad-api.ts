import type { Address,Hex } from "viem";
import { getChainDescriptor } from "@zkblast/config";
import { SdkError } from "./errors.js";

export type LaunchpadApiRuntime = Readonly<{ apiUrl: string;environment: "testnet"|"mainnet";chainId: number;explorerUrl: string }>;
export type LaunchpadCursorPage<T> = Readonly<{ items: readonly T[];nextCursor: string|null;indexedBlock: string;finalizedBlock: string;observedAt: string }>;
export type LaunchpadRecord = Readonly<{ launchpadId: string;owner: Address;treasury: Address;operator: Address;configPresetId: string;status: number;updatedAt: string }>;
export type LaunchpadTrade = Readonly<{ eventId: string;launchpadId: string;transactionHash: Hex;trader: Address;side: "buy"|"sell";quoteRaw: string;baseRaw: string;blockNumber: string;timestamp: string }>;
export type LaunchpadQuote = Readonly<{ pool: Address;side: "buy"|"sell";amountInRaw: string;amountOutRaw: string;feeRaw: string;observedBlock: string;expiresAt: string }>;
export type DeveloperAuthorization = Readonly<{ ownerAddress: Address;signature: Hex;signedAt: string }>;

function boundedLimit(limit=25) {
  if (!Number.isInteger(limit)||limit<1||limit>100) throw new SdkError("INVALID_LIMIT","Limit must be between 1 and 100");
  return limit;
}
export function resolveLaunchpadApiRuntime(config: unknown): LaunchpadApiRuntime {
  if (!config || typeof config!=="object") throw new SdkError("INVALID_API_CONFIG","API config is unavailable");
  const value=config as Record<string,unknown>;
  if ((value.environment!=="testnet"&&value.environment!=="mainnet")||typeof value.chainId!=="number"||typeof value.explorerUrl!=="string") throw new SdkError("INVALID_API_CONFIG","API network config is invalid");
  let descriptor;
  try { descriptor=getChainDescriptor(value.chainId); } catch { throw new SdkError("INVALID_CHAIN","API chain is unsupported"); }
  if (value.environment!==descriptor.environment) throw new SdkError("INVALID_CHAIN","API environment and chain ID do not match");
  const apiUrl=typeof value.apiUrl==="string"?value.apiUrl:"";
  if (!apiUrl.startsWith("https://")&&!apiUrl.startsWith("http://localhost")) throw new SdkError("INVALID_API_CONFIG","API URL must use HTTPS");
  return { apiUrl:apiUrl.replace(/\/$/u,""),environment:value.environment,chainId:value.chainId,explorerUrl:value.explorerUrl };
}

export class LaunchpadApiClient {
  constructor(readonly runtime: LaunchpadApiRuntime,private readonly fetcher: typeof fetch=fetch) {}
  private get basePath() { return `/v2/chains/${this.runtime.chainId}/launchpads`; }
  private async request<T>(path: string,init?: RequestInit): Promise<T> {
    const response=await this.fetcher(`${this.runtime.apiUrl}${path}`,{ ...init,headers:{ "content-type":"application/json",...init?.headers } });
    const payload=await response.json().catch(()=>null) as { error?: { code?: string } }|null;
    if (!response.ok) throw new SdkError("LAUNCHPAD_API_REQUEST_FAILED",payload?.error?.code??`HTTP_${response.status}`);
    return payload as T;
  }
  records(input: { owner?: Address;cursor?: string;limit?: number }={}) {
    const query=new URLSearchParams({ limit:String(boundedLimit(input.limit)) });
    if (input.owner) query.set("owner",input.owner);
    if (input.cursor) query.set("cursor",input.cursor);
    return this.request<LaunchpadCursorPage<LaunchpadRecord>>(`${this.basePath}/records?${query}`);
  }
  detail(launchpadId: bigint) { return this.request<LaunchpadRecord>(`${this.basePath}/${launchpadId}`); }
  trades(launchpadId: bigint,input: { cursor?: string;limit?: number }={}) {
    const query=new URLSearchParams({ limit:String(boundedLimit(input.limit)) });
    if (input.cursor) query.set("cursor",input.cursor);
    return this.request<LaunchpadCursorPage<LaunchpadTrade>>(`${this.basePath}/${launchpadId}/trades?${query}`);
  }
  quote(launchpadId: bigint,input: { pool: Address;side: "buy"|"sell";amountInRaw: bigint }) {
    if (input.amountInRaw<=0n) throw new SdkError("INVALID_AMOUNT","Quote amount must be positive");
    return this.request<LaunchpadQuote>(`${this.basePath}/${launchpadId}/quote`,{ method:"POST",body:JSON.stringify({ ...input,amountInRaw:input.amountInRaw.toString() }) });
  }
  tokens(launchpadId: bigint,limit=25) { return this.request(`${this.basePath}/${launchpadId}/tokens?limit=${boundedLimit(limit)}`); }
  graduations(launchpadId: bigint,limit=25) { return this.request(`${this.basePath}/${launchpadId}/graduations?limit=${boundedLimit(limit)}`); }
  publishBranding(input: { branding: unknown;version: number;ownerAddress: Address;signature: Hex;signedAt: string;logo: { mime: string;base64: string }|null;favicon: { mime: string;base64: string }|null }) { return this.request(`${this.basePath}/branding`,{ method:"POST",body:JSON.stringify(input) }); }
  issueDomain(input: { launchpadId: bigint;hostname: string;authorization: DeveloperAuthorization }) { return this.request(`${this.basePath}/domains/challenge`,{ method:"POST",body:JSON.stringify({ launchpadId:input.launchpadId.toString(),hostname:input.hostname,...input.authorization }) }); }
  verifyDomain(domainId: string,authorization: DeveloperAuthorization) { return this.request(`${this.basePath}/domains/${domainId}/verify`,{ method:"POST",body:JSON.stringify(authorization) }); }
  revokeDomain(domainId: string,authorization: DeveloperAuthorization) { return this.request(`${this.basePath}/domains/${domainId}`,{ method:"DELETE",body:JSON.stringify(authorization) }); }
  developerSnapshot(launchpadId: bigint,authorization: DeveloperAuthorization) { return this.request(`${this.basePath}/${launchpadId}/developer/snapshot`,{ method:"POST",body:JSON.stringify({ authorization }) }); }
  createApiKey(launchpadId: bigint,input: { name: string;scopes: readonly string[];authorization: DeveloperAuthorization }) { return this.request(`${this.basePath}/${launchpadId}/developer/api-keys`,{ method:"POST",body:JSON.stringify(input) }); }
  registerWebhook(launchpadId: bigint,input: { url: string;eventTypes: readonly string[];authorization: DeveloperAuthorization }) { return this.request(`${this.basePath}/${launchpadId}/developer/webhooks`,{ method:"POST",body:JSON.stringify(input) }); }
}

export function launchpadCapabilities(config: Readonly<{ launchpad?: unknown;dbc?: { dlmmGraduationAdapter?: string|null } }>) {
  return { launchpad: Boolean(config.launchpad),damm: Boolean(config.launchpad),dlmm: Boolean(config.dbc?.dlmmGraduationAdapter) } as const;
}
