import { z } from "zod";

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

export const BuildTxBody = z.object({
  opportunity_id: z.number().int().positive(),
  wallet_address: z
    .string()
    .regex(
      /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
      "Invalid Solana wallet address",
    ),
  amount: z
    .string()
    .refine(
      (v) => !isNaN(Number(v)) && Number(v) >= 0,
      "Amount must be a non-negative number",
    ),
  simulate: z.boolean().default(false),
  extra_data: z.record(z.unknown()).optional(),
});

export const SubmitTxBody = z.object({
  signed_transaction: z
    .string()
    .min(1, "signed_transaction is required"),
});

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

export const SerializableInstructionSchema = z.object({
  programAddress: z.string(),
  accounts: z.array(
    z.object({
      address: z.string(),
      role: z.number().int().min(0).max(3),
    }),
  ),
  data: z.string(),
});

export const SimulationSchema = z.object({
  success: z.boolean(),
  computeUnits: z.number().nullable(),
  fee: z.number().nullable(),
  error: z.string().nullable(),
  logs: z.array(z.string()).optional(),
});

export const BuildTxResponse = z.object({
  instructions: z.array(SerializableInstructionSchema),
  lookupTableAddresses: z.array(z.string()).optional(),
  setupInstructionSets: z
    .array(z.array(SerializableInstructionSchema))
    .optional(),
  simulation: SimulationSchema.optional(),
});

export const SubmitTxResponse = z.object({
  signature: z.string(),
  status: z.enum(["submitted"]),
});

// ---------------------------------------------------------------------------
// Balance + withdraw state
// ---------------------------------------------------------------------------

export const BalanceBody = z.object({
  opportunity_id: z.number().int().positive(),
  wallet_address: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana wallet address"),
  extra_data: z.record(z.unknown()).optional(),
});

export const WalletBalanceBody = z.object({
  wallet_address: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana wallet address"),
  mint: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana mint address"),
  fresh: z.boolean().optional(),
});

export const WithdrawStateBody = z.object({
  opportunity_id: z.number().int().positive(),
  wallet_address: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana wallet address"),
});

export const FormatQuery = z.object({
  format: z.enum(["instructions", "assembled"]).default("instructions"),
});

export const PriceImpactBody = z.object({
  opportunity_id: z.number().int().positive(),
  wallet_address: z
    .string()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana wallet address"),
  amount: z.string().refine(
    (v) => !isNaN(Number(v)) && Number(v) > 0,
    "Amount must be a positive number",
  ),
  direction: z.enum(["deposit", "withdraw"]),
  extra_data: z.record(z.unknown()).optional(),
});
