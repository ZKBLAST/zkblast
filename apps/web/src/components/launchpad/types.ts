export type DbcTemplate = Readonly<{
  template_id: string;
  family_id: string;
  config_hash: string;
  version: number;
  enabled: boolean;
  used: boolean;
  config?: Readonly<{
    totalSupplyRaw?: string;
    baseInventoryRaw?: string;
    graduationThresholdRaw?: string;
    tradeFeeBps?: number;
    destinationFeePips?: number;
  }>;
}>;
export type TemplateEconomics = Readonly<{
  quoteToken: string;
  quoteSymbol: string;
  quoteDecimals: number;
  migrationMode: 0 | 1;
  totalSupplyRaw: string;
  baseInventoryRaw: string;
  graduationThresholdRaw: string;
  destinationFeePips: number;
  terminalPriceToleranceBps: number;
  tradeFeeBps: number;
  creatorFeeShareBps: number;
  partnerFeeShareBps: number;
  protocolFeeShareBps: number;
  creatorLpShareBps: number;
  creatorLockSeconds: number;
  curveSegments: readonly Readonly<{
    initialPriceX18: string;
    slopeX18: string;
    saleCapacityX18: string;
  }>[];
}>;
export type StockQuoteAssetView = Readonly<{
  chainId: number;
  contractAddress: string;
  issuerAssetId: string;
  symbol: string;
  instrumentName: string;
  issuerName: string;
  tokenDecimals: number;
  currentMultiplier: string;
  pendingMultiplier: string | null;
  availability:
    | "discovered"
    | "verified"
    | "eligible"
    | "listed"
    | "suspended"
    | "disabled";
  marketState:
    "active" | "after_hours" | "closed" | "halted" | "degraded" | "emergency";
  quoteTradingEnabled: boolean;
  graduationEnabled: boolean;
  priceFeedAddress: string | null;
  maxOracleAgeSeconds: number | null;
  sourceObservedAt: string;
  updatedAt: string;
}>;
export type StockQuoteDestinationView = Readonly<{
  migrationMode: "damm" | "dlmm";
  enabled: boolean;
  fundedAcceptanceHash: string | null;
}>;
export type StockQuotePreviewView = Readonly<{
  chainId: number;
  contractAddress: string;
  symbol: string;
  amountRaw: string;
  amount: string;
  tokenDecimals: number;
  multiplier: string;
  multiplierX18: string;
  marketState: StockQuoteAssetView["marketState"];
  availability: StockQuoteAssetView["availability"];
  operation: "create_launch" | "fund" | "buy" | "sell" | "graduate" | "exit";
  operationAllowed: boolean;
  migrationMode: "damm" | "dlmm";
  destinationEnabled: boolean;
  oracleConfigured: boolean;
  oraclePriceX18?: string;
  oracleUpdatedAt?: string;
  oracleRoundId?: string;
  usdNotionalX18: string | null;
  executable: boolean;
  reasons: readonly string[];
}>;
export type ProtectionPolicy = Readonly<{
  chain_id: number;
  policy_id: string;
  family_id: string;
  policy_hash: string;
  version: number;
  protection_blocks: string;
  max_buy_bps_per_transaction: number;
  max_buy_bps_per_address: number;
  initial_fee_bps: number;
  base_fee_bps: number;
  lp_lock_seconds: string;
  enabled: boolean;
  used: boolean;
}>;
export type ProtectedLaunchPreview = Readonly<{
  chainId: number;
  policyId: string;
  policyHash: string;
  policyVersion: number;
  protectionStartBlock: string;
  protectionEndBlock: string;
  maximumPerTransactionRaw: string;
  maximumPerAddressRaw: string;
  initialFeeBps: number;
  baseFeeBps: number;
  lpLockSeconds: string;
  enforcement: "onchain";
}>;
export type ProtectedLaunchSecurity = Readonly<{
  chain_id: number;
  launch_id: string;
  policy_id: string;
  policy_hash: string;
  policy_version: number;
  protection_start_block: string;
  protection_blocks: string;
  max_buy_bps_per_transaction: number;
  max_buy_bps_per_address: number;
  initial_fee_bps: number;
  base_fee_bps: number;
  lp_lock_seconds: string;
  migration_id: string | null;
  creator_unlock_at: string | null;
  creator_claimed: boolean | null;
  protocol_claimed: boolean | null;
  accounting_reconciles: boolean | null;
}>;
export type ProtectedLaunchIdentity = Readonly<{
  chain_id: number;
  launch_id: string;
  canonical_hash: string;
  token_runtime_code_hash: string;
  token_template_version: number;
  duplicate_name: boolean;
  duplicate_symbol: boolean;
  transaction_hash: string;
}>;
export type DbcLaunch = Readonly<{
  launch_id: string;
  template_id: string;
  creator: string;
  token_address: string;
  virtual_pool: string;
  quote_token: string;
  name: string | null;
  symbol: string | null;
  metadata_uri: string | null;
  metadata_id?: string | null;
  website_url?: string | null;
  x_url?: string | null;
  has_logo?: boolean;
  lifecycle: number;
  real_quote_reserve_raw: string;
  base_sold_raw: string;
  graduation_threshold_raw: string | null;
  progress_bps: number;
  created_block: string;
  updated_block: string;
  volume_raw?: string;
  trade_count?: number;
  holder_count?: number;
  creator_claimable_raw?: string;
  protocol_claimable_raw?: string;
  launchpad_bound?: boolean;
  launchpad_id?: string | null;
  fee_snapshot_id?: string | null;
  binding_schema_version?: number | null;
  launchpad_treasury?: string | null;
  launchpad_config_preset_id?: string | null;
  launchpad_config_hash?: string | null;
  graduation_destination?: number | null;
  graduation_migration_id?: string | null;
  graduation_status?:
    "GRADUATING" | "PENDING_RETRY" | "GRADUATED" | "FAILED_NEEDS_REVIEW" | null;
  graduation_attempts?: number | null;
  graduation_failure_hash?: string | null;
  graduation_transaction_hash?: string | null;
}>;
export type DbcCandle = Readonly<{
  bucket: string;
  open_x18: string;
  high_x18: string;
  low_x18: string;
  close_x18: string;
  base_volume_raw: string;
  quote_volume_raw: string;
  trades: number;
}>;
export type DbcTrade = Readonly<{
  transaction_hash: string;
  log_index: number;
  trader: string;
  recipient: string;
  is_buy: boolean;
  quote_amount_raw: string;
  base_amount_raw: string;
  fee_raw: string;
  price_x18: string;
  block_number: string;
  observed_at: string;
}>;
export type DbcGraduation = Readonly<{
  migration_id: string;
  destination_pool: string;
  destination_shares_raw: string;
  transaction_hash: string;
  block_number: string;
  allocations: readonly Readonly<{
    allocation_kind: "creator" | "protocol";
    shares_raw: string;
    unlock_at: string | null;
    claimed: boolean;
  }>[];
}>;
