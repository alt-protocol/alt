/**
 * Module isolation test — verifies no cross-module DB schema imports.
 * This is a static analysis test that reads source files.
 *
 * Rules (from CLAUDE.md):
 * - Discover files never import from manage/db/ or monitor/db/
 * - Manage files never import from monitor/db/
 * - Monitor files never import from discover/db/ or manage/db/
 * - Cross-module reads only through service interfaces (not DB schemas)
 *
 * Exception: shared/auth.ts imports manage/db/schema.ts (API keys are in manage schema).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC_DIR = join(import.meta.dirname!, "..");

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry === "__tests__" || entry === "node_modules" || entry === "e2e") continue;
      const stat = statSync(full);
      if (stat.isDirectory()) {
        files.push(...getAllTsFiles(full));
      } else if (entry.endsWith(".ts")) {
        files.push(full);
      }
    }
  } catch {}
  return files;
}

function getImports(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  const imports: string[] = [];
  // Match both `import ... from "..."` and `await import("...")`
  const regex = /(?:from|import)\s*\(\s*["']([^"']+)["']\s*\)|from\s*["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    imports.push(match[1] || match[2]);
  }
  return imports;
}

describe("Module isolation", () => {
  it("Discover module does not import from manage/db/ or monitor/db/", () => {
    const files = getAllTsFiles(join(SRC_DIR, "discover"));
    const violations: string[] = [];

    for (const file of files) {
      const imports = getImports(file);
      for (const imp of imports) {
        if (imp.includes("manage/db/") || imp.includes("monitor/db/")) {
          violations.push(`${relative(SRC_DIR, file)} imports "${imp}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("Manage module does not import from monitor/db/", () => {
    const files = getAllTsFiles(join(SRC_DIR, "manage"));
    const violations: string[] = [];

    for (const file of files) {
      const imports = getImports(file);
      for (const imp of imports) {
        if (imp.includes("monitor/db/")) {
          violations.push(`${relative(SRC_DIR, file)} imports "${imp}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("Monitor module does not import from manage/db/", () => {
    const files = getAllTsFiles(join(SRC_DIR, "monitor"));
    const violations: string[] = [];

    for (const file of files) {
      const imports = getImports(file);
      for (const imp of imports) {
        if (imp.includes("manage/db/")) {
          violations.push(`${relative(SRC_DIR, file)} imports "${imp}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // Known violation: monitor/service.ts imports discover/db/schema.js for
  // join queries. Tracked as tech debt — should use discoverService interface.
  it("Monitor module discover/db/ imports are limited to known exceptions", () => {
    const files = getAllTsFiles(join(SRC_DIR, "monitor"));
    const violations: string[] = [];
    const knownExceptions = ["monitor/service.ts"];

    for (const file of files) {
      const fileName = relative(SRC_DIR, file);
      if (knownExceptions.some((e) => fileName.endsWith(e))) continue;

      const imports = getImports(file);
      for (const imp of imports) {
        if (imp.includes("discover/db/")) {
          violations.push(`${fileName} imports "${imp}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("shared/ only accesses manage/db/schema for auth (API keys)", () => {
    const files = getAllTsFiles(join(SRC_DIR, "shared"));
    const violations: string[] = [];
    const allowed = ["auth.ts"]; // auth.ts needs manage/db/schema for apiKeys table

    for (const file of files) {
      const fileName = file.split("/").pop()!;
      if (allowed.includes(fileName)) continue;

      const imports = getImports(file);
      for (const imp of imports) {
        if (
          imp.includes("discover/db/") ||
          imp.includes("manage/db/") ||
          imp.includes("monitor/db/")
        ) {
          violations.push(`${relative(SRC_DIR, file)} imports "${imp}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
