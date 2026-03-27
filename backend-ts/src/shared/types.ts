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
  first_token: string | null;
}

export interface DiscoverService {
  getOpportunityById(id: number): Promise<OpportunityDetail | null>;
  getOpportunityMap(): Promise<Record<string, OpportunityMapEntry>>;
}
