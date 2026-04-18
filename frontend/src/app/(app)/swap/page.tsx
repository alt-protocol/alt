"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Script from "next/script";
import { useJupiterWalletPassthrough } from "@/lib/hooks/useJupiterWalletPassthrough";

declare global {
  interface Window {
    Jupiter?: {
      init(config: Record<string, unknown>): void;
      close(): void;
      syncProps(props: Record<string, unknown>): void;
    };
  }
}

function SwapContent() {
  const initialized = useRef(false);
  const walletPassthrough = useJupiterWalletPassthrough();
  const searchParams = useSearchParams();
  const outputMint = searchParams.get("outputMint");

  const jupiterConfig = {
    displayMode: "integrated",
    integratedTargetId: "jupiter-terminal",
    formProps: {
      initialInputMint: "So11111111111111111111111111111111111111112",
      ...(outputMint && { initialOutputMint: outputMint }),
    },
    containerStyles: { height: "500px" },
    defaultExplorer: "Solscan",
    enableWalletPassthrough: true,
    onRequestConnectWallet: () => {
      document.dispatchEvent(new CustomEvent("akashi:connect-wallet"));
    },
  };

  // Sync wallet state to Jupiter widget whenever it changes
  useEffect(() => {
    if (initialized.current && window.Jupiter) {
      window.Jupiter.syncProps({
        passthroughWalletContextState: walletPassthrough,
      });
    }
  }, [walletPassthrough]);

  const handleReady = () => {
    if (!initialized.current && window.Jupiter) {
      window.Jupiter.init({
        ...jupiterConfig,
        passthroughWalletContextState: walletPassthrough,
      });
      initialized.current = true;
    }
  };

  useEffect(() => {
    // Client-side navigation: script already loaded, init immediately
    if (!initialized.current && window.Jupiter) {
      window.Jupiter.init({
        ...jupiterConfig,
        passthroughWalletContextState: walletPassthrough,
      });
      initialized.current = true;
    }
    return () => {
      if (window.Jupiter) {
        window.Jupiter.close();
        initialized.current = false;
      }
    };
  }, []);

  return (
    <>
      <div id="jupiter-terminal" className="min-h-[520px]" />
      <Script
        src="https://plugin.jup.ag/plugin-v1.js"
        data-preload
        strategy="afterInteractive"
        onReady={handleReady}
      />
    </>
  );
}

export default function SwapPage() {
  return (
    <main className="px-4 sm:px-8 lg:px-[3.5rem] py-6 max-w-xl mx-auto">
      <h1 className="font-display text-xl mb-6">Swap</h1>
      <Suspense>
        <SwapContent />
      </Suspense>
    </main>
  );
}
