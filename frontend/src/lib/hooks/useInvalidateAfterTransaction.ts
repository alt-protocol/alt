"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "@/lib/queryKeys";
import { api } from "@/lib/api";

interface InvalidateParams {
  walletAddress: string;
  opportunityId?: number;
  vaultAddress?: string;
  /** Deposit token mint — used for cache-busted refetch after tx. */
  mint?: string;
  /** Protocol metadata to store with the position (e.g. Jupiter nft_id). */
  metadata?: Record<string, unknown>;
}

export function useInvalidateAfterTransaction() {
  const queryClient = useQueryClient();

  const invalidateAfterTx = useCallback(
    async ({ walletAddress, opportunityId, vaultAddress, mint, metadata }: InvalidateParams) => {
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

      // Cache-busted refetch — bypass backend 15s cache to get real on-chain balance
      if (mint) {
        setTimeout(async () => {
          try {
            const { balance } = await api.getWalletBalance({
              wallet_address: walletAddress,
              mint,
              fresh: true,
            });
            queryClient.setQueryData(["tokenBalance", walletAddress, mint], balance);
          } catch { /* optimistic holds, normal polling catches up */ }
        }, 3000);
      }

      // Sync the specific position to Monitor DB (fast: 1 RPC call + DB write)
      // Awaited so DB is fresh before settling ends — optimistic update covers instant UX
      if (opportunityId) {
        try {
          await api.syncPosition(walletAddress, opportunityId, metadata);
        } catch { /* optimistic holds, trackWallet will catch up */ }
        queryClient.invalidateQueries({ queryKey: queryKeys.positions.list(walletAddress) });
        queryClient.invalidateQueries({ queryKey: queryKeys.positions.events(walletAddress) });
        queryClient.invalidateQueries({ queryKey: ["positionHistory", walletAddress] });
        queryClient.invalidateQueries({ queryKey: queryKeys.wallet.status(walletAddress) });
      }

      // Full background re-fetch for all positions (fire-and-forget, slower)
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
