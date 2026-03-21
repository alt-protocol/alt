STABLECOIN_SYMBOLS: set[str] = {
    # Pure USD stablecoins
    "USDC", "USDC-1", "USDC-Dep",
    "USDT",
    "USDS",
    "USDG",
    "PYUSD",
    "FDUSD",
    "EURC",
    "USDe", "sUSDe",
    "USDY",
    "USD1",
    "AUSD",
    "USDH",
    "USX",
    "eUSX",
    "JupUSD",
    # RWA / yield-bearing USD tokens
    "PRIME",        # Parcl RWA
    "syrupUSDC",    # Maple Finance
    "USCC",         # Superstate US Gov
    "CASH",         # Ondo USDY
    "FWDI",         # Franklin Money Market
    "wYLDS",        # Yield tokenization
    "ONyc",         # Ondo (stored as ONyc in DB)
    "JUICED",       # Kamino JUICED vault
}


def compute_depeg(symbol: str, price_usd: float | None) -> float | None:
    """Return |price - $1| for stablecoins, None otherwise."""
    if symbol not in STABLECOIN_SYMBOLS or price_usd is None:
        return None
    return round(abs(price_usd - 1.0), 6)
