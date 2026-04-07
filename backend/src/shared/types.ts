export interface OpportunityDetail {
  id: number;
  protocol_id: number;
  external_id: string | null;
  name: string;
  category: string;
  tokens: string[];
  apy_current: number | null;
  tvl_usd: number | null;
  deposit_address: string | null;
  extra_data: Record<string, unknown> | null;
  protocol: {
    id: number;
    slug: string;
    name: string;
  } | null;
}

export interface OpportunityMapEntry {
  id: number;
  apy_current: number | null;
  tvl_usd: number | null;
  first_token: string | null;
}

export interface DiscoverService {
  getOpportunityById(id: number): Promise<OpportunityDetail | null>;
  getOpportunityMap(): Promise<Record<string, OpportunityMapEntry>>;
}

/** Token exposure entry — stored in underlying_tokens JSONB column. */
export interface UnderlyingToken {
  symbol: string;
  mint: string | null;
  role: string; // "underlying" | "collateral" | "debt" | "pool_a" | "pool_b" | ...
  type: "stablecoin" | "yield_bearing_stable" | "lst" | "volatile";
}

/** JSON-safe instruction format returned by Manage routes. */
export interface SerializableInstruction {
  programAddress: string;
  accounts: Array<{ address: string; role: number }>; // 0=readonly, 1=writable, 2=readonlySigner, 3=writableSigner
  data: string; // base64-encoded
}
