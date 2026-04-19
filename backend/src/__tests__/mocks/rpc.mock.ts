import { vi } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Mock factory for @solana/kit RPC client (returned by getRpc()). */
export function createMockRpc() {
  const makeSendable = (value: any) => ({
    send: vi.fn().mockResolvedValue(value),
  });

  return {
    getLatestBlockhash: vi.fn().mockReturnValue(
      makeSendable({
        value: {
          blockhash: "mock_blockhash_abc123",
          lastValidBlockHeight: 200n,
        },
        context: { slot: 100n },
      }),
    ),
    getBalance: vi.fn().mockReturnValue(
      makeSendable({ value: 1_000_000_000n, context: { slot: 100n } }),
    ),
    getAccountInfo: vi.fn().mockReturnValue(
      makeSendable({ value: null, context: { slot: 100n } }),
    ),
    getTokenAccountsByOwner: vi.fn().mockReturnValue(
      makeSendable({ value: [], context: { slot: 100n } }),
    ),
    getMultipleAccounts: vi.fn().mockReturnValue(
      makeSendable({ value: [], context: { slot: 100n } }),
    ),
    getSignatureStatuses: vi.fn().mockReturnValue(
      makeSendable({
        value: [{ confirmationStatus: "confirmed", err: null }],
        context: { slot: 100n },
      }),
    ),
    sendTransaction: vi.fn().mockReturnValue(
      makeSendable("mock_signature_abc123"),
    ),
    simulateTransaction: vi.fn().mockReturnValue(
      makeSendable({
        value: { err: null, unitsConsumed: 200_000n, logs: [] },
        context: { slot: 100n },
      }),
    ),
  };
}

/** Mock factory for legacy @solana/web3.js Connection (returned by getLegacyConnection()). */
export function createMockLegacyConnection() {
  return {
    getBalance: vi.fn().mockResolvedValue(1_000_000_000),
    getAccountInfo: vi.fn().mockResolvedValue(null),
    simulateTransaction: vi.fn().mockResolvedValue({
      value: { err: null, unitsConsumed: 200_000, logs: [] },
    }),
    sendRawTransaction: vi.fn().mockResolvedValue("mock_signature_abc123"),
    sendTransaction: vi.fn().mockResolvedValue("mock_signature_abc123"),
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: "mock_blockhash_abc123",
      lastValidBlockHeight: 200,
    }),
    getSignatureStatus: vi.fn().mockResolvedValue({
      value: { confirmationStatus: "confirmed", err: null },
    }),
    getParsedTokenAccountsByOwner: vi.fn().mockResolvedValue({ value: [] }),
    getTokenAccountBalance: vi.fn().mockResolvedValue({
      value: { uiAmount: 100.0, decimals: 6, amount: "100000000" },
    }),
    getProgramAccounts: vi.fn().mockResolvedValue([]),
    getSlot: vi.fn().mockResolvedValue(100),
    confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
  };
}
