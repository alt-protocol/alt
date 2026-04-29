function bad(n: number | null | undefined): boolean {
  return n == null || !Number.isFinite(n);
}

export function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (bad(n)) return "\u2014";
  return n!.toFixed(decimals);
}

export function fmtApy(n: number | null | undefined): string {
  if (bad(n)) return "\u2014";
  return `${n!.toFixed(2)}%`;
}

export function fmtTvl(n: number | null | undefined): string {
  if (bad(n)) return "\u2014";
  if (n! >= 1_000_000_000) return `$${(n! / 1_000_000_000).toFixed(1)}B`;
  if (n! >= 1_000_000) return `$${(n! / 1_000_000).toFixed(1)}M`;
  if (n! >= 1_000) return `$${(n! / 1_000).toFixed(0)}K`;
  return `$${n!.toFixed(0)}`;
}

export function fmtUsd(n: number | null | undefined): string {
  if (bad(n)) return "\u2014";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n!);
}

export function fmtPnlUsd(n: number | null | undefined): string {
  if (bad(n)) return "\u2014";
  if (n! > 0 && n! < 0.01) return "<$0.01";
  if (n! < 0 && n! > -0.01) return ">-$0.01";
  return fmtUsd(n);
}

export function fmtPct(n: number | null | undefined): string {
  if (bad(n)) return "\u2014";
  const sign = n! > 0 ? "+" : "";
  return `${sign}${n!.toFixed(2)}%`;
}

export function fmtDays(n: number | null | undefined): string {
  if (bad(n)) return "\u2014";
  return `${n!.toFixed(1)}d`;
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "\u2014";
  const d = new Date(s);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtDateShort(s: string | null | undefined): string {
  if (!s) return "\u2014";
  const d = new Date(s);
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

export function fmtCategory(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}


export function fmtProductType(t: string): string {
  const map: Record<string, string> = {
    earn_vault: "Earn Vault",
    earn: "Earn",
    lending: "Lend",
    multiply: "Multiply",
    lp: "LP",
    insurance: "Insurance",
    insurance_fund: "Insurance Fund",
  };
  return map[t] ?? t;
}

const VAULT_TAG_LABELS: Record<string, string> = {
  rwa_loop: "RWA Loop",
  stable_loop: "Stable Loop",
  sol_loop: "SOL Loop",
  directional_leverage: "Directional",
};

export function fmtVaultTag(tag: string | null | undefined): string {
  if (!tag) return "Multiply";
  return VAULT_TAG_LABELS[tag] ?? fmtCategory(tag);
}

export function truncateId(id: string, len = 12): string {
  if (id.length <= len) return id;
  return id.slice(0, len) + "\u2026";
}

export function pnlColor(n: number | null | undefined): string {
  if (bad(n)) return "text-foreground-muted";
  if (n! > 0) return "text-neon";
  if (n! < 0) return "text-red-400";
  return "text-foreground-muted";
}

export function fmtPegAdherence(n: number | null | undefined): string {
  if (bad(n)) return "\u2014";
  return `${n!.toFixed(1)}%`;
}

export function fmtDeviation(n: number | null | undefined): string {
  if (bad(n)) return "\u2014";
  return `${n!.toFixed(3)}%`;
}

export function fmtVolatility(n: number | null | undefined): string {
  if (bad(n)) return "\u2014";
  return `${n!.toFixed(4)}%`;
}

export function pegColor(adherence: number | null | undefined): string {
  if (bad(adherence)) return "text-foreground-muted";
  if (adherence! >= 99.5) return "text-neon";
  if (adherence! >= 99.0) return "text-foreground";
  if (adherence! >= 98.0) return "text-yellow-400";
  return "text-red-400";
}

export function fmtSpread(min: number | null | undefined, max: number | null | undefined): string {
  if (bad(min) || bad(max) || min! <= 0) return "\u2014";
  const spread = (max! - min!) / min! * 100;
  return `${spread.toFixed(2)}%`;
}

export function fmtPriceRange(min: number | null | undefined, max: number | null | undefined): string {
  if (bad(min) || bad(max)) return "\u2014";
  return `$${min!.toFixed(4)}\u2013$${max!.toFixed(4)}`;
}

const SHIELD_LABELS: Record<string, string> = {
  NOT_VERIFIED: "Unverified",
  LOW_ORGANIC_ACTIVITY: "Low activity",
  NEW_LISTING: "New listing",
  HAS_FREEZE_AUTHORITY: "Freezable",
  HAS_MINT_AUTHORITY: "Mintable",
  HAS_PERMANENT_DELEGATE: "Permanent delegate",
  NOT_SELLABLE: "Not sellable",
  LOW_LIQUIDITY: "Low liquidity",
  HIGH_SINGLE_OWNERSHIP: "Concentrated",
};

export function fmtShieldWarning(type: string): string {
  return SHIELD_LABELS[type] ?? type;
}

/** Compute a spread percentage from min/max price. Returns null if data insufficient. */
export function spreadPct(min: number | null | undefined, max: number | null | undefined): number | null {
  if (bad(min) || bad(max) || min! <= 0) return null;
  return (max! - min!) / min! * 100;
}

/** Color class for a volatility spread percentage. */
export function volatilityColor(pct: number | null): string {
  if (pct == null) return "text-foreground-muted";
  if (pct < 0.1) return "text-neon";
  if (pct <= 0.5) return "text-yellow-400";
  return "text-red-400";
}

export interface RiskLevel {
  label: string;
  colorClass: string;
  reasons: string[];
}

/** Compute a 1-word risk assessment from yield opportunity fields. */
export function computeRiskLevel(opts: {
  tokenWarnings?: { type: string; severity: string; message: string }[] | null;
  spreadPct: number | null;
  lockPeriodDays: number;
  pegLiquidityUsd?: number | null;
}): RiskLevel {
  const reasons: string[] = [];
  let level: "Clear" | "Note" | "Review" = "Clear";

  // Token warnings
  if (opts.tokenWarnings && opts.tokenWarnings.length > 0) {
    const hasWarning = opts.tokenWarnings.some(w => w.severity === "warning");
    for (const w of opts.tokenWarnings) {
      reasons.push(SHIELD_LABELS[w.type] ?? w.type);
    }
    if (hasWarning) level = "Review";
    else level = "Note";
  }

  // Spread
  if (opts.spreadPct != null) {
    if (opts.spreadPct > 0.5) {
      level = "Review";
      reasons.push(`${opts.spreadPct.toFixed(2)}% price spread`);
    } else if (opts.spreadPct > 0.2) {
      if (level !== "Review") level = "Note";
      reasons.push(`${opts.spreadPct.toFixed(2)}% price spread`);
    }
  }

  // Lock period
  if (opts.lockPeriodDays > 7) {
    if (level !== "Review") level = "Note";
    reasons.push(`${opts.lockPeriodDays}d lock`);
  } else if (opts.lockPeriodDays > 0) {
    reasons.push(`${opts.lockPeriodDays}d lock`);
  }

  // DEX liquidity in tooltip
  if (opts.pegLiquidityUsd != null) {
    reasons.push(`${fmtTvl(opts.pegLiquidityUsd)} DEX liquidity`);
  }

  const colorClass = level === "Review" ? "text-red-400" : level === "Note" ? "text-yellow-400" : "text-neon";
  return { label: level, colorClass, reasons };
}
