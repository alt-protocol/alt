"use client";

import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  signAndSendTransactionMessageWithSigners,
  getBase58Decoder, signature, address, none,
} from "@solana/kit";
import type { TransactionSendingSigner } from "@solana/signers";
import type { YieldOpportunityDetail } from "@/lib/api";
import { getRpc } from "@/lib/rpc";
import { buildTransactionMessage } from "@/lib/transaction-utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

const LUT_WARMUP_MS = 2000;
const CONFIRM_POLL_MS = 1500;
const CONFIRM_MAX_ATTEMPTS = 20;

/**
 * Check if the user's multiply LUT needs setup by calling the SDK.
 * Uses a read-only placeholder signer — only checks, doesn't embed signer in ixs.
 */
async function checkNeedsSetup(
  marketAddress: string, collMint: string, debtMint: string, walletAddress: string,
): Promise<boolean> {
  const sdk = await import("@kamino-finance/klend-sdk");
  const { getRpc } = await import("@/lib/rpc");

  const rpc = getRpc() as any;
  const market = await sdk.KaminoMarket.load(rpc, address(marketAddress), sdk.DEFAULT_RECENT_SLOT_DURATION_MS);
  if (!market) throw new Error("Market load failed");

  const placeholder = { address: address(walletAddress) } as any;
  const multiplyMints = [{ coll: address(collMint), debt: address(debtMint) }];
  const [, setupTxsIxs] = await sdk.getUserLutAddressAndSetupIxs(
    market, placeholder, none(), true, multiplyMints, [],
  );

  return setupTxsIxs.some((ixs: any[]) => ixs.length > 0);
}

/**
 * Fetch setup instructions with the REAL signer (same instance used for fee payer).
 */
async function fetchSetupIxs(
  signer: TransactionSendingSigner, marketAddress: string, collMint: string, debtMint: string,
) {
  const sdk = await import("@kamino-finance/klend-sdk");
  const { getRpc } = await import("@/lib/rpc");

  const rpc = getRpc() as any;
  const market = await sdk.KaminoMarket.load(rpc, address(marketAddress), sdk.DEFAULT_RECENT_SLOT_DURATION_MS);
  if (!market) throw new Error("Market load failed");

  const multiplyMints = [{ coll: address(collMint), debt: address(debtMint) }];
  const [, setupTxsIxs] = await sdk.getUserLutAddressAndSetupIxs(
    market, signer, none(), true, multiplyMints, [],
  );

  return setupTxsIxs.filter((ixs: any[]) => ixs.length > 0);
}

/** Poll getSignatureStatuses until confirmed or max attempts reached. */
async function waitForConfirmation(rpc: any, sig: string): Promise<boolean> {
  for (let i = 0; i < CONFIRM_MAX_ATTEMPTS; i++) {
    const { value } = await rpc.getSignatureStatuses([signature(sig)]).send();
    const status = value?.[0]?.confirmationStatus;
    if (status === "confirmed" || status === "finalized") return true;
    await new Promise((r) => setTimeout(r, CONFIRM_POLL_MS));
  }
  return false;
}

/**
 * Hook: check if the user's multiply LUT needs setup + provide setup function.
 *
 * Flow:
 * 1. On mount: check if setup needed (read-only, cached 60s)
 * 2. If needed: show "Setup Account" button
 * 3. On runSetup: fetch fresh ixs with real signer → send → poll for confirmation → verify on-chain
 */
export function useMultiplySetup(
  signer: TransactionSendingSigner | null,
  yield_: YieldOpportunityDetail,
) {
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const extra = yield_.extra_data;
  const marketAddress = extra?.market as string | undefined;
  const collMint = extra?.collateral_mint as string | undefined;
  const debtMint = extra?.debt_mint as string | undefined;
  const walletAddress = signer?.address as string | undefined;
  const enabled = !!walletAddress && !!marketAddress && !!collMint && !!debtMint;

  const queryKey = ["multiplySetup", walletAddress, marketAddress, collMint, debtMint];

  const { data: needsSetup, isLoading: isChecking } = useQuery({
    queryKey,
    queryFn: () => checkNeedsSetup(marketAddress!, collMint!, debtMint!, walletAddress!),
    enabled,
    staleTime: 60_000,
    retry: 1,
  });

  const runSetup = useCallback(async () => {
    if (!signer || !marketAddress || !collMint || !debtMint) return;
    setIsSettingUp(true);
    setError(null);

    try {
      const setupSets = await fetchSetupIxs(signer, marketAddress, collMint, debtMint);
      if (setupSets.length === 0) {
        // Already set up — refresh state
        queryClient.setQueryData(queryKey, false);
        return;
      }

      const rpc = getRpc();

      for (const setupIxs of setupSets) {
        const { value: bh } = await rpc.getLatestBlockhash({ commitment: "finalized" }).send();
        const msg = buildTransactionMessage(signer, bh, setupIxs);
        const sigBytes = await signAndSendTransactionMessageWithSigners(msg);
        const sig = getBase58Decoder().decode(sigBytes);

        // Wait for on-chain confirmation
        setIsVerifying(true);
        const confirmed = await waitForConfirmation(rpc, sig);
        if (!confirmed) throw new Error("Setup transaction not confirmed — please try again");

        // LUT warmup
        await new Promise((r) => setTimeout(r, LUT_WARMUP_MS));
      }

      // Verify on-chain: re-check if setup is still needed
      const stillNeeded = await checkNeedsSetup(marketAddress, collMint, debtMint, walletAddress!);
      queryClient.setQueryData(queryKey, stillNeeded);

      if (stillNeeded) {
        setError("Setup may have failed — please try again");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Setup failed";
      if (msg.includes("User rejected") || msg.includes("user reject")) {
        setError("Setup rejected by wallet");
      } else if (msg.includes("Simulation") || msg.includes("simulation")) {
        // Simulation failure likely means LUT already exists — re-check
        const stillNeeded = await checkNeedsSetup(marketAddress, collMint, debtMint, walletAddress!).catch(() => true);
        queryClient.setQueryData(queryKey, stillNeeded);
        if (!stillNeeded) {
          setError(null); // Actually already set up!
        } else {
          setError("Setup transaction failed — please try again");
        }
      } else {
        setError(msg);
      }
    } finally {
      setIsSettingUp(false);
      setIsVerifying(false);
    }
  }, [signer, marketAddress, collMint, debtMint, walletAddress, queryClient, queryKey]);

  return {
    needsSetup: needsSetup ?? true,
    isChecking: isChecking || !enabled,
    isSettingUp,
    isVerifying,
    error,
    runSetup,
  };
}
