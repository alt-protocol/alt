"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "@/lib/queryKeys";
import type { UserPositionOut } from "@/lib/api";

export type TxOperation = "deposit" | "withdraw" | "close";

interface OptimisticUpdateParams {
  walletAddress: string;
  mint?: string;
  opportunityId?: number;
  operation: TxOperation;
  amount: number;
}

/**
 * Apply optimistic updates to TanStack Query cache immediately
 * after transaction confirms, before backend refetches return.
 *
 * Updates both balance queries (tokenBalance, positionBalance) and
 * the positions list (shared across detail + portfolio pages).
 *
 * Returns a rollback function that restores previous values.
 */
export function useOptimisticBalanceUpdate() {
  const queryClient = useQueryClient();

  return useCallback(
    ({ walletAddress, mint, opportunityId, operation, amount }: OptimisticUpdateParams) => {
      const walletKey = mint ? ["tokenBalance", walletAddress, mint] : null;
      const positionKey =
        opportunityId != null ? ["positionBalance", walletAddress, opportunityId] : null;
      const positionsListKey = queryKeys.positions.list(walletAddress);

      const prevWallet = walletKey ? queryClient.getQueryData<number>(walletKey) : undefined;
      const prevPosition = positionKey ? queryClient.getQueryData<number>(positionKey) : undefined;
      const prevPositionsList = queryClient.getQueryData<UserPositionOut[]>(positionsListKey);

      // --- Balance optimistic updates ---
      if (operation === "deposit") {
        if (walletKey && prevWallet != null) {
          queryClient.setQueryData(walletKey, Math.max(0, prevWallet - amount));
        }
        if (positionKey) {
          queryClient.setQueryData(positionKey, (prevPosition ?? 0) + amount);
        }
      } else if (operation === "withdraw") {
        if (positionKey && prevPosition != null) {
          queryClient.setQueryData(positionKey, Math.max(0, prevPosition - amount));
        }
        if (walletKey) {
          queryClient.setQueryData(walletKey, (prevWallet ?? 0) + amount);
        }
      } else if (operation === "close") {
        if (positionKey) {
          queryClient.setQueryData(positionKey, 0);
        }
      }

      // --- Positions list optimistic update (visible on portfolio page) ---
      if (prevPositionsList && opportunityId != null) {
        queryClient.setQueryData<UserPositionOut[]>(positionsListKey, (old) => {
          if (!old) return old;
          return old.map((p) => {
            if (p.opportunity_id !== opportunityId || p.is_closed) return p;
            if (operation === "close") {
              return { ...p, is_closed: true, deposit_amount: 0, deposit_amount_usd: 0 };
            }
            if (operation === "withdraw" && p.deposit_amount != null) {
              return { ...p, deposit_amount: Math.max(0, p.deposit_amount - amount) };
            }
            if (operation === "deposit" && p.deposit_amount != null) {
              return { ...p, deposit_amount: p.deposit_amount + amount };
            }
            return p;
          });
        });
      }

      return () => {
        if (walletKey && prevWallet !== undefined) {
          queryClient.setQueryData(walletKey, prevWallet);
        }
        if (positionKey && prevPosition !== undefined) {
          queryClient.setQueryData(positionKey, prevPosition);
        }
        if (prevPositionsList) {
          queryClient.setQueryData(positionsListKey, prevPositionsList);
        }
      };
    },
    [queryClient],
  );
}
