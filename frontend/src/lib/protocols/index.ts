import type { ProtocolAdapter } from "./types";

const SUPPORTED_ADAPTERS = new Set(["kamino", "jupiter", "drift"]);

const adapterCache = new Map<string, ProtocolAdapter>();

export async function getAdapter(slug: string): Promise<ProtocolAdapter | undefined> {
  const key = slug.toLowerCase();
  if (!SUPPORTED_ADAPTERS.has(key)) return undefined;

  const cached = adapterCache.get(key);
  if (cached) return cached;

  if (key === "kamino") {
    const { kaminoAdapter } = await import("./kamino");
    adapterCache.set(key, kaminoAdapter);
    return kaminoAdapter;
  }

  if (key === "jupiter") {
    const { jupiterAdapter } = await import("./jupiter");
    adapterCache.set(key, jupiterAdapter);
    return jupiterAdapter;
  }

  if (key === "drift") {
    const { driftAdapter } = await import("./drift");
    adapterCache.set(key, driftAdapter);
    return driftAdapter;
  }

  return undefined;
}

export function hasAdapter(slug: string): boolean {
  return SUPPORTED_ADAPTERS.has(slug.toLowerCase());
}
