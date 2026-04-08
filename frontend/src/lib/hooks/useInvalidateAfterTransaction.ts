"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { UserPositionOut } from "@/lib/api";
import type { WithdrawState } from "@/lib/tx-types";
import { queryKeys } from "@/lib/queryKeys";

interface InvalidateParams {
  walletAddress: string;
  tokenSymbol?: string;
  opportunityId?: number;
  vaultAddress?: string;
  txType?: "deposit" | "withdraw";
  txAmount?: number;
}

export function useInvalidateAfterTransaction() {
  const queryClient = useQueryClient();

  const invalidateAfterTx = useCallback(
    async ({ walletAddress, tokenSymbol, opportunityId, vaultAddress, txType, txAmount }: InvalidateParams) => {
      // Optimistic position update — adjust cached balance before backend catches up
      if (opportunityId && txType && txAmount) {
        const positionsKey = queryKeys.positions.list(walletAddress);
        const cached = queryClient.getQueryData<UserPositionOut[]>(positionsKey);
        if (cached) {
          const hasMatch = cached.some((p) => p.opportunity_id === opportunityId && !p.is_closed);
          const updated = cached.map((p) => {
            if (p.opportunity_id !== opportunityId || p.is_closed) return p;
            const current = p.deposit_amount ?? 0;
            const newAmount = txType === "withdraw" ? current - txAmount : current + txAmount;
            return {
              ...p,
              deposit_amount: Math.max(0, newAmount),
              deposit_amount_usd: Math.max(0, newAmount),
              is_closed: newAmount <= 0 ? true : p.is_closed,
            };
          });
          // First deposit — no existing position in cache, create a synthetic entry
          if (!hasMatch && txType === "deposit") {
            updated.push({
              id: -1,
              wallet_address: walletAddress,
              protocol_slug: "",
              product_type: "",
              external_id: "",
              opportunity_id: opportunityId,
              deposit_amount: txAmount,
              deposit_amount_usd: txAmount,
              pnl_usd: 0,
              pnl_pct: 0,
              initial_deposit_usd: txAmount,
              opened_at: null,
              held_days: null,
              apy: null,
              apy_realized: null,
              is_closed: false,
              closed_at: null,
              close_value_usd: null,
              token_symbol: tokenSymbol ?? null,
              underlying_tokens: null,
              extra_data: null,
              snapshot_at: new Date().toISOString(),
            } as UserPositionOut);
          }
          queryClient.setQueryData(positionsKey, updated);
        }
      }

      // Optimistic withdrawState update — show new state immediately before RPC catches up
      if (opportunityId && walletAddress && txType === "withdraw") {
        const wsKey = ["withdrawState", walletAddress, opportunityId];
        const cachedWs = queryClient.getQueryData<WithdrawState | null>(wsKey);
        if (cachedWs?.status === "redeemable") {
          // Step 2 completed: redeemable → none (withdrawal executed)
          queryClient.setQueryData(wsKey, { status: "none" } as WithdrawState);
        } else if (cachedWs && cachedWs.status === "none") {
          // Step 1 completed: none → pending (withdrawal requested)
          queryClient.setQueryData(wsKey, {
            status: "pending",
            message: "Withdrawal requested. Waiting for on-chain confirmation...",
            requestedAmount: txAmount ?? 0,
          } as WithdrawState);
        }
      }

      // Optimistic positionBalance update
      if (opportunityId && walletAddress && txType && txAmount) {
        const balKey = ["positionBalance", walletAddress, opportunityId];
        const cachedBalance = queryClient.getQueryData<number | null>(balKey);
        if (cachedBalance != null) {
          const newBalance = txType === "withdraw"
            ? Math.max(0, cachedBalance - txAmount)
            : cachedBalance + txAmount;
          queryClient.setQueryData(balKey, newBalance);
        } else if (txType === "deposit") {
          // First deposit — no cached balance yet, seed with deposit amount
          queryClient.setQueryData(balKey, txAmount);
        }
      }

      // Critical refetches — await so UI has fresh data before re-enabling
      const critical: Promise<void>[] = [];
      if (tokenSymbol) {
        critical.push(
          queryClient.invalidateQueries({
            queryKey: queryKeys.wallet.tokenBalance(walletAddress, tokenSymbol),
          }),
        );
      }
      if (vaultAddress) {
        critical.push(
          queryClient.invalidateQueries({
            queryKey: queryKeys.vault.balance(walletAddress, vaultAddress),
          }),
          queryClient.invalidateQueries({
            queryKey: ["positionBalance", walletAddress],
            exact: false,
          }),
          queryClient.invalidateQueries({
            queryKey: ["withdrawState", walletAddress],
            exact: false,
          }),
        );
      }
      await Promise.allSettled(critical);

      // Non-critical — fire-and-forget (backend-dependent, slow)
      // Note: positions.list is NOT invalidated here — the immediate refetch would
      // overwrite the optimistic update above with stale backend data (Monitor runs
      // every 15 min). Positions are refreshed in the 5s delayed callback instead.
      queryClient.invalidateQueries({ queryKey: queryKeys.positions.events(walletAddress) });
      queryClient.invalidateQueries({ queryKey: queryKeys.wallet.status(walletAddress) });
      queryClient.invalidateQueries({
        queryKey: ["positionHistory", walletAddress],
      });
      if (opportunityId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.yields.detail(String(opportunityId)),
        });
      }

      // Delayed re-fetch for backend-dependent data (positions, events, history)
      // Backend needs time to detect on-chain changes
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: queryKeys.positions.list(walletAddress) });
        queryClient.invalidateQueries({ queryKey: queryKeys.positions.events(walletAddress) });
        queryClient.invalidateQueries({
          queryKey: ["positionHistory", walletAddress],
        });
        // Reconcile optimistic state with real on-chain data
        if (vaultAddress) {
          queryClient.invalidateQueries({ queryKey: ["withdrawState", walletAddress], exact: false });
          queryClient.invalidateQueries({ queryKey: ["positionBalance", walletAddress], exact: false });
          queryClient.invalidateQueries({ queryKey: queryKeys.vault.balance(walletAddress, vaultAddress) });
        }
        if (tokenSymbol) {
          queryClient.invalidateQueries({ queryKey: queryKeys.wallet.tokenBalance(walletAddress, tokenSymbol) });
        }
      }, 5000);

      // Safety net — some RPCs lag 5-10s for account state changes
      setTimeout(() => {
        if (vaultAddress) {
          queryClient.invalidateQueries({ queryKey: ["withdrawState", walletAddress], exact: false });
          queryClient.invalidateQueries({ queryKey: ["positionBalance", walletAddress], exact: false });
        }
      }, 10_000);
    },
    [queryClient],
  );

  return invalidateAfterTx;
}
