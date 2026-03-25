"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "@/lib/queryKeys";

interface InvalidateParams {
  walletAddress: string;
  tokenSymbol?: string;
  opportunityId?: number;
}

export function useInvalidateAfterTransaction() {
  const queryClient = useQueryClient();

  const invalidateAfterTx = useCallback(
    ({ walletAddress, tokenSymbol, opportunityId }: InvalidateParams) => {
      // Immediate invalidations — client-side and position data
      queryClient.invalidateQueries({ queryKey: queryKeys.positions.list(walletAddress) });
      queryClient.invalidateQueries({ queryKey: queryKeys.positions.events(walletAddress) });
      queryClient.invalidateQueries({ queryKey: queryKeys.wallet.status(walletAddress) });

      // Invalidate all position history periods (prefix match)
      queryClient.invalidateQueries({
        queryKey: ["positionHistory", walletAddress],
      });

      // Token balance — direct RPC, updates immediately
      if (tokenSymbol) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.wallet.tokenBalance(walletAddress, tokenSymbol),
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
