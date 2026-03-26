"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { UserPositionOut } from "@/lib/api";
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
    ({ walletAddress, tokenSymbol, opportunityId, vaultAddress, txType, txAmount }: InvalidateParams) => {
      // Optimistic position update — adjust cached balance before backend catches up
      if (opportunityId && txType && txAmount) {
        const positionsKey = queryKeys.positions.list(walletAddress);
        const cached = queryClient.getQueryData<UserPositionOut[]>(positionsKey);
        if (cached) {
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
          queryClient.setQueryData(positionsKey, updated);
        }
      }

      // Immediate invalidations — client-side and position data
      queryClient.invalidateQueries({ queryKey: queryKeys.positions.list(walletAddress) });
      queryClient.invalidateQueries({ queryKey: queryKeys.positions.events(walletAddress) });
      queryClient.invalidateQueries({ queryKey: queryKeys.wallet.status(walletAddress) });

      // Invalidate all position history periods (prefix match)
      queryClient.invalidateQueries({
        queryKey: ["positionHistory", walletAddress],
      });

      // Token balance + vault balance — direct RPC, updates immediately
      if (tokenSymbol) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.wallet.tokenBalance(walletAddress, tokenSymbol),
        });
      }
      if (vaultAddress) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.vault.balance(walletAddress, vaultAddress),
        });
      }

      // Yield detail TVL may change after large deposits
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
      }, 5000);
    },
    [queryClient],
  );

  return invalidateAfterTx;
}
