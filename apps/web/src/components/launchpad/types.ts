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
