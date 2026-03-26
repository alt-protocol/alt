"use client";

/**
 * @deprecated Use useTransaction from "./useTransaction" instead.
 * This module re-exports the unified hook for backwards compatibility.
 */
export { useTransaction as useMultiplyTransaction } from "./useTransaction";
export type { TxStatus as MultiplyTxStatus } from "./useTransaction";
