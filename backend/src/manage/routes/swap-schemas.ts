import { z } from "zod";

const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ---------------------------------------------------------------------------
// Quote (GET query params)
// ---------------------------------------------------------------------------

export const SwapQuoteQuery = z.object({
  inputMint: z.string().regex(base58Regex, "Invalid inputMint"),
  outputMint: z.string().regex(base58Regex, "Invalid outputMint"),
  amount: z
    .string()
    .refine(
      (v) => !isNaN(Number(v)) && Number(v) > 0,
      "Amount must be a positive number",
    ),
  slippageBps: z.coerce.number().int().min(1).max(500).default(50),
  taker: z.string().regex(base58Regex, "Invalid taker address"),
});

// ---------------------------------------------------------------------------
// Build swap (POST body)
// ---------------------------------------------------------------------------

export const BuildSwapBody = z.object({
  wallet_address: z
    .string()
    .regex(base58Regex, "Invalid Solana wallet address"),
  input_mint: z.string().regex(base58Regex, "Invalid input_mint"),
  output_mint: z.string().regex(base58Regex, "Invalid output_mint"),
  amount: z
    .string()
    .refine(
      (v) => !isNaN(Number(v)) && Number(v) > 0,
      "Amount must be a positive number",
    ),
  slippage_bps: z.number().int().min(1).max(500).default(50),
});
