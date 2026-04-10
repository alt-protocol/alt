"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "@/lib/queryKeys";
import { api } from "@/lib/api";

interface InvalidateParams {
  walletAddress: string;
  opportunityId?: number;
  vaultAddress?: string;
}

export function useInvalidateAfterTransaction() {
  const queryClient = useQueryClient();

  const invalidateAfterTx = useCallback(
    async ({ walletAddress, opportunityId, vaultAddress }: InvalidateParams) => {
      // Critical refetches — await so UI has fresh blockchain data before re-enabling
      const critical: Promise<void>[] = [];
      // Invalidate all token balance queries for this wallet
      critical.push(
        queryClient.invalidateQueries({
          queryKey: ["tokenBalance", walletAddress],
          exact: false,
        }),
      );
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

      // Trigger backend to re-fetch positions from blockchain (fire-and-forget)
      api.trackWallet(walletAddress).catch(() => {});

      // Non-critical — fire-and-forget (backend-dependent, slow)
      queryClient.invalidateQueries({ queryKey: queryKeys.positions.list(walletAddress) });
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
        if (vaultAddress) {
          queryClient.invalidateQueries({ queryKey: ["withdrawState", walletAddress], exact: false });
          queryClient.invalidateQueries({ queryKey: ["positionBalance", walletAddress], exact: false });
          queryClient.invalidateQueries({ queryKey: queryKeys.vault.balance(walletAddress, vaultAddress) });
        }
        queryClient.invalidateQueries({ queryKey: ["tokenBalance", walletAddress], exact: false });
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
