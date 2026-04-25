import type { OpportunityDetail } from "../../shared/types.js";

/** Valid Solana wallet address for testing. */
export const TEST_WALLET = "11111111111111111111111111111112";

/** Invalid wallet addresses for edge case testing. */
export const INVALID_WALLETS = {
  tooShort: "abc",
  tooLong: "11111111111111111111111111111111111111111111111111",
  badChars: "0OIl11111111111111111111111111111", // 0, O, I, l are not valid base58
  empty: "",
};

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

export const FIXTURES: Record<string, OpportunityDetail> = {
  jupiterEarnUSDC: {
    id: 1,
    protocol_id: 1,
    external_id: "jlp-usdc",
    name: "Jupiter Earn USDC",
    category: "earn",
    tokens: ["USDC"],
    apy_current: 8.5,
    tvl_usd: 50_000_000,
    deposit_address: USDC_MINT,
    max_leverage: null,
    extra_data: { mint: USDC_MINT },
    protocol: { id: 1, slug: "jupiter", name: "Jupiter" },
  },
  kaminoVaultUSDC: {
    id: 2,
    protocol_id: 2,
    external_id: "kamino-vault-usdc",
    name: "Kamino Vault USDC",
    category: "earn",
    tokens: ["USDC"],
    apy_current: 12.0,
    tvl_usd: 100_000_000,
    deposit_address: "KVaULT111111111111111111111111111111111111",
    max_leverage: null,
    extra_data: { vault_address: "KVaULT111111111111111111111111111111111111" },
    protocol: { id: 2, slug: "kamino", name: "Kamino" },
  },
  kaminoMultiplySOL: {
    id: 3,
    protocol_id: 2,
    external_id: "kamino-multiply-sol",
    name: "Kamino Multiply SOL/USDC",
    category: "multiply",
    tokens: ["SOL", "USDC"],
    apy_current: 25.0,
    tvl_usd: 30_000_000,
    deposit_address: "KMkt111111111111111111111111111111111111111",
    max_leverage: 5.0,
    extra_data: {
      market_address: "KMkt111111111111111111111111111111111111111",
      collateral_mint: SOL_MINT,
      debt_mint: USDC_MINT,
    },
    protocol: { id: 2, slug: "kamino", name: "Kamino" },
  },
  driftInsuranceFund: {
    id: 4,
    protocol_id: 3,
    external_id: "drift-if-usdc",
    name: "Drift Insurance Fund USDC",
    category: "insurance_fund",
    tokens: ["USDC"],
    apy_current: 6.0,
    tvl_usd: 20_000_000,
    deposit_address: "Drift11111111111111111111111111111111111111",
    max_leverage: null,
    extra_data: { market_index: 0 },
    protocol: { id: 3, slug: "drift", name: "Drift" },
  },
  inactiveOpportunity: {
    id: 99,
    protocol_id: 1,
    external_id: "inactive",
    name: "Inactive Opportunity",
    category: "earn",
    tokens: ["USDC"],
    apy_current: null,
    tvl_usd: null,
    deposit_address: null,
    max_leverage: null,
    extra_data: null,
    protocol: { id: 1, slug: "jupiter", name: "Jupiter" },
  },
  unknownProtocol: {
    id: 100,
    protocol_id: 99,
    external_id: "unknown",
    name: "Unknown Protocol Opp",
    category: "earn",
    tokens: ["USDC"],
    apy_current: 5.0,
    tvl_usd: 1_000_000,
    deposit_address: "Unknown1111111111111111111111111111111111",
    max_leverage: null,
    extra_data: null,
    protocol: { id: 99, slug: "unknown_protocol", name: "Unknown" },
  },
};
