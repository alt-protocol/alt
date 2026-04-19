/**
 * CRITICAL SAFETY TEST — Non-custodial constraint enforcement.
 *
 * The backend MUST NEVER handle private keys or sign transactions.
 * These tests verify this invariant at multiple levels:
 * 1. Static analysis of source code
 * 2. Runtime output verification of buildTransaction
 * 3. Drift dummyWallet passthrough verification
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// ---- Static analysis helpers ----

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "__tests__" || entry === "node_modules") continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...getAllTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

// Resolve src/manage/ relative to this test file
const MANAGE_DIR = join(import.meta.dirname!, "..");
const MANAGE_FILES = getAllTsFiles(MANAGE_DIR);

describe("Non-custodial constraint", () => {
  describe("Static analysis — no signing code in manage module", () => {
    // Helper to strip comments from source before analysis
    function stripComments(code: string): string {
      return code
        .replace(/\/\/.*$/gm, "") // line comments
        .replace(/\/\*[\s\S]*?\*\//g, ""); // block comments
    }

    it("never imports Keypair.fromSecretKey for real signing", () => {
      const violations: string[] = [];
      for (const file of MANAGE_FILES) {
        const content = stripComments(readFileSync(file, "utf-8"));
        if (/Keypair\.fromSecretKey/.test(content)) {
          violations.push(file);
        }
      }
      expect(violations).toEqual([]);
    });

    it("never references secretKey or privateKey variables", () => {
      const violations: string[] = [];
      const pattern = /\b(secretKey|privateKey|private_key)\b/;
      for (const file of MANAGE_FILES) {
        const content = stripComments(readFileSync(file, "utf-8"));
        if (pattern.test(content)) {
          violations.push(file);
        }
      }
      expect(violations).toEqual([]);
    });

    it("never imports nacl or ed25519 signing libraries", () => {
      const violations: string[] = [];
      const pattern = /\b(tweetnacl|ed25519|nacl\.sign)\b/;
      for (const file of MANAGE_FILES) {
        const content = stripComments(readFileSync(file, "utf-8"));
        if (pattern.test(content)) {
          violations.push(file);
        }
      }
      expect(violations).toEqual([]);
    });

    it("signTransaction is only used as a passthrough (dummyWallet pattern)", () => {
      const violations: string[] = [];
      for (const file of MANAGE_FILES) {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comment-only lines
          if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
          // Allow the dummyWallet passthrough pattern: signTransaction: async (t) => t
          // Also allow signAllTransactions with same identity pattern
          if (/sign(All)?Transaction/.test(line) && !/async\s*\([^)]*\)\s*=>\s*\w/.test(line)) {
            violations.push(`${file}:${i + 1}: ${line.trim()}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it("never calls .sign() on transaction objects", () => {
      const violations: string[] = [];
      // Pattern: tx.sign( or transaction.sign( — real signing
      // Exclude: signTransaction (covered above) and SDK type references
      const pattern = /\b\w+\.sign\s*\(/;
      for (const file of MANAGE_FILES) {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
          if (pattern.test(line) && !/signTransaction|signAllTransaction/.test(line)) {
            violations.push(`${file}:${i + 1}: ${line.trim()}`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe("buildTransaction output", () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it("returns instructions array, never a signed transaction", async () => {
      // Mock dependencies for buildTransaction
      vi.doMock("../../discover/service.js", () => ({
        discoverService: {
          getOpportunityById: vi.fn().mockResolvedValue({
            id: 1,
            protocol_id: 1,
            name: "Test",
            category: "earn",
            tokens: ["USDC"],
            apy_current: 5,
            tvl_usd: 1000,
            deposit_address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            extra_data: {},
            protocol: { id: 1, slug: "jupiter", name: "Jupiter" },
            external_id: null,
          }),
        },
      }));

      const mockInstruction = {
        programAddress: "ComputeBudget111111111111111111111111111111",
        accounts: [],
        data: new Uint8Array([1, 0, 0, 0]),
      };

      vi.doMock("../protocols/index.js", () => ({
        getAdapter: vi.fn().mockResolvedValue({
          buildDepositTx: vi.fn().mockResolvedValue([mockInstruction]),
          buildWithdrawTx: vi.fn().mockResolvedValue([mockInstruction]),
        }),
        hasAdapter: vi.fn().mockReturnValue(true),
      }));

      const { buildTransaction } = await import("../services/tx-builder.js");
      const result = await buildTransaction(
        {
          opportunity_id: 1,
          wallet_address: "11111111111111111111111111111112",
          amount: "100",
        },
        "deposit",
      );

      // Must have instructions array
      expect(result.instructions).toBeInstanceOf(Array);
      expect(result.instructions.length).toBeGreaterThan(0);

      // Must have serializable shape (programAddress, accounts, data as base64 string)
      for (const ix of result.instructions) {
        expect(typeof ix.programAddress).toBe("string");
        expect(Array.isArray(ix.accounts)).toBe(true);
        expect(typeof ix.data).toBe("string"); // base64 encoded
      }

      // Must NOT contain signatures or signed transaction bytes
      expect(result).not.toHaveProperty("signatures");
      expect(result).not.toHaveProperty("signedTransaction");
      expect(result).not.toHaveProperty("transaction");
    });
  });

  describe("Drift dummyWallet", () => {
    it("signTransaction is a passthrough (returns the same object)", () => {
      // The dummyWallet pattern at drift.ts:42-46 must be identity
      // We test this by reading the source and verifying the pattern
      const driftSource = readFileSync(
        join(MANAGE_DIR, "protocols", "drift.ts"),
        "utf-8",
      );

      // Verify the dummyWallet pattern exists: signTransaction: async (t: any) => t
      expect(driftSource).toMatch(/signTransaction:\s*async\s*\([^)]*\)\s*=>\s*\w/);
      expect(driftSource).toMatch(/signAllTransactions:\s*async\s*\([^)]*\)\s*=>\s*\w/);

      // Verify no real signing logic — the function body should just return the argument
      // Match: `async (t: any) => t` or `async (t) => t` (identity function)
      const signLine = driftSource
        .split("\n")
        .find((l) => l.includes("signTransaction:"));
      expect(signLine).toBeDefined();
      // Ensure it's the identity pattern: `async (x) => x` (not calling .sign() or similar)
      expect(signLine).not.toMatch(/\.sign\(/);
      expect(signLine).not.toMatch(/Keypair/);
    });
  });
});
