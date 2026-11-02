import { DbcClient,LaunchpadApiClient,LaunchpadClient,LaunchpadRevenueClient,assertDbcPreflight,encodePreparedContractCall,type CreateLaunchpadRequest,type DbcAddresses,type LaunchpadTokenRequest,type PreparedContractCall } from "@zkblast/sdk";
import type { Address,Hex } from "viem";

export interface BrowserWallet {
  request(input: { method: string;params?: readonly unknown[] }): Promise<unknown>;
}
export type FlowReceipt = Readonly<{ transactionHash: Hex;blockNumber: bigint }>;
export class PublicLaunchpadFlow {
  readonly launchpad: LaunchpadClient;
  readonly dbc: DbcClient;
  readonly revenue: LaunchpadRevenueClient;
  constructor(readonly api: LaunchpadApiClient,launchpad: LaunchpadClient,dbcAddresses: DbcAddresses,private readonly wallet: BrowserWallet) {
    this.launchpad=launchpad;this.dbc=new DbcClient(dbcAddresses);this.revenue=new LaunchpadRevenueClient(launchpad.addresses.revenueSplitter);
  }
  async submit(call: PreparedContractCall,from: Address): Promise<Hex> {
    const chain=Number(await this.wallet.request({ method:"eth_chainId" }));
    if (chain!==this.api.runtime.chainId) throw new Error("INVALID_CHAIN");
    const encoded=encodePreparedContractCall(call);
    return await this.wallet.request({ method:"eth_sendTransaction",params:[{ from,to:encoded.to,data:encoded.data }] }) as Hex;
  }
  createLaunchpad(input: CreateLaunchpadRequest,from: Address) { return this.submit(this.launchpad.createLaunchpad(input),from); }
  launchToken(input: LaunchpadTokenRequest,from: Address) { return this.submit(this.launchpad.createToken(input),from); }
  async buy(input: { pool: Address;quoteRaw: bigint;quotedBaseRaw: bigint;minimumBaseRaw: bigint;maximumPriceX18: bigint;recipient: Address;deadline: bigint;balance: bigint;allowance: bigint;quoteObservedAt: number },from: Address) {
    assertDbcPreflight({ expectedChainId:this.api.runtime.chainId,actualChainId:Number(await this.wallet.request({ method:"eth_chainId" })),nowSeconds:Math.floor(Date.now()/1000),deadline:input.deadline,requiredBalance:input.quoteRaw,balance:input.balance,requiredAllowance:input.quoteRaw,allowance:input.allowance,quoteObservedAtSeconds:input.quoteObservedAt,maximumQuoteAgeSeconds:60,quotedAmountOut:input.quotedBaseRaw,minimumAmountOut:input.minimumBaseRaw,maximumSlippageBps:500 });
    return this.submit(this.dbc.buyExactInput({ pool:input.pool,grossQuoteInRaw:input.quoteRaw,minimumBaseOutRaw:input.minimumBaseRaw,maximumPriceX18:input.maximumPriceX18,recipient:input.recipient,deadline:input.deadline }),from);
  }
  async waitForTrade(launchpadId: bigint,hash: Hex,attempts=20) {
    for (let attempt=0;attempt<attempts;attempt+=1) { const page=await this.api.trades(launchpadId,{ limit:100 });const trade=page.items.find((item)=>item.transactionHash.toLowerCase()===hash.toLowerCase());if (trade) return trade;await new Promise((resolve)=>setTimeout(resolve,1_500)); }
    throw new Error("TRADE_INDEX_TIMEOUT");
  }
  claimFees(snapshotId: Hex,from: Address) { return this.submit(this.revenue.claim(snapshotId),from); }
  inspectGraduation(launchpadId: bigint) { return this.api.graduations(launchpadId,25); }
}
