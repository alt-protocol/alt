"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import SolanaProviders from "@/components/SolanaProviders";

const SignContent = dynamic(() => import("./SignContent"), { ssr: false });

export default function SignPage() {
  return (
    <SolanaProviders>
      <div className="min-h-screen bg-surface text-foreground flex items-center justify-center p-4">
        <SignContent />
      </div>
    </SolanaProviders>
  );
}
