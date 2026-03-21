"""Preview Drift API data without touching the database.

Hits https://data.api.drift.trade and https://app.drift.trade directly
and prints formatted tables for insurance fund entries and vaults.

Run from repo root with venv active:
    python scripts/preview_drift.py
"""
import sys

import httpx

DRIFT_API = "https://data.api.drift.trade"
DRIFT_APP_API = "https://app.drift.trade"
DRIFT_MAINNET_API = "https://mainnet-beta.api.drift.trade"
MIN_VAULT_TVL_USD = 10_000

STABLE_SYMBOLS = {"USDC", "USDT", "PYUSD", "USDe", "USDS", "DAI", "USDY"}


def _get(path: str, client: httpx.Client):
    r = client.get(f"{DRIFT_API}{path}", timeout=30)
    r.raise_for_status()
    return r.json()


def _unwrap_insurance_fund(raw) -> list:
    """Unwrap /stats/insuranceFund response envelope."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        data = raw.get("data", {})
        if isinstance(data, dict) and "marketSharePriceData" in data:
            return data["marketSharePriceData"]
        if isinstance(data, list):
            return data
    return []


def _unwrap_vaults(raw) -> list:
    """Unwrap /stats/vaults response envelope."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        if "vaults" in raw:
            return raw["vaults"]
        data = raw.get("data", [])
        if isinstance(data, list):
            return data
    return []


def _float(val):
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _fmt_num(val, decimals=2):
    if val is None:
        return "—"
    return f"{val:,.{decimals}f}"


def _fmt_int(val):
    if val is None:
        return "—"
    return f"{int(val):,}"


def _fetch_vault_apys(client: httpx.Client) -> dict[str, dict]:
    """Fetch vault APY data from app.drift.trade/api/vaults."""
    print("Fetching app.drift.trade/api/vaults (APY data) ...", flush=True)
    try:
        r = client.get(f"{DRIFT_APP_API}/api/vaults", timeout=30)
        r.raise_for_status()
        raw = r.json()
    except Exception as exc:
        print(f"  WARNING: failed to fetch APY data: {exc}", file=sys.stderr)
        return {}

    result: dict[str, dict] = {}
    if not isinstance(raw, dict):
        return result

    for pubkey, info in raw.items():
        if not isinstance(info, dict):
            continue
        apys = info.get("apys", {})
        result[pubkey] = {
            "apy_7d": _float(apys.get("7d")),
            "apy_30d": _float(apys.get("30d")),
            "apy_90d": _float(apys.get("90d")),
            "apy_180d": _float(apys.get("180d")),
            "apy_365d": _float(apys.get("365d")),
            "max_drawdown_pct": _float(info.get("maxDrawdownPct")),
        }
    print(f"  Got APY data for {len(result)} vaults")
    return result



def _fetch_if_market_data(client: httpx.Client) -> dict[int, dict]:
    """Fetch IF vault addresses and staked shares from spotMarketAccounts."""
    print("Fetching mainnet-beta spotMarketAccounts (IF data) ...", flush=True)
    try:
        r = client.get(f"{DRIFT_MAINNET_API}/stats/spotMarketAccounts", timeout=30)
        r.raise_for_status()
        raw = r.json()
    except Exception as exc:
        print(f"  WARNING: failed to fetch spotMarketAccounts: {exc}", file=sys.stderr)
        return {}

    if isinstance(raw, dict):
        raw = raw.get("result", [])
    if not isinstance(raw, list):
        return {}

    result: dict[int, dict] = {}
    for acct in raw:
        market_index = acct.get("marketIndex")
        if market_index is None:
            continue
        insurance_fund = acct.get("insuranceFund", {})
        vault = insurance_fund.get("vault")
        total_shares_hex = insurance_fund.get("totalShares")
        decimals = acct.get("decimals", 6)

        tvl_tokens = None
        if total_shares_hex is not None:
            try:
                tvl_tokens = int(total_shares_hex, 16) / 10**decimals
            except (ValueError, TypeError):
                pass

        unstaking_period_days = None
        unstaking_hex = insurance_fund.get("unstakingPeriod")
        if unstaking_hex is not None:
            try:
                unstaking_period_days = round(int(unstaking_hex, 16) / 86400, 1)
            except (ValueError, TypeError):
                pass

        result[int(market_index)] = {
            "deposit_address": vault,
            "tvl_tokens": tvl_tokens,
            "decimals": decimals,
            "unstaking_period_days": unstaking_period_days,
        }

    print(f"  Got IF data for {len(result)} markets")
    return result


def preview_insurance_fund(client: httpx.Client) -> dict[int, str]:
    print("Fetching /stats/insuranceFund ...", flush=True)
    raw = _get("/stats/insuranceFund", client)
    data = _unwrap_insurance_fund(raw)
    if not data:
        print("ERROR: unexpected response format or empty data", file=sys.stderr)
        return {}

    # Fetch IF vault addresses and staked shares
    if_market_data = _fetch_if_market_data(client)

    market_index_map: dict[int, str] = {}
    rows = []

    for entry in data:
        idx = entry.get("marketIndex")
        symbol = entry.get("symbol", "")
        if idx is not None and symbol:
            market_index_map[int(idx)] = symbol

        apy = _float(entry.get("apy"))

        # Enrich with spotMarketAccounts data
        mkt_data = if_market_data.get(int(idx), {}) if idx is not None else {}
        deposit_address = mkt_data.get("deposit_address", "")
        tvl_tokens = mkt_data.get("tvl_tokens")

        # TVL in USD for stablecoins
        tvl_usd = tvl_tokens if symbol in STABLE_SYMBOLS and tvl_tokens is not None else None
        tvl_str = _fmt_int(tvl_usd) if tvl_usd is not None else (_fmt_num(tvl_tokens, 0) + " tkn" if tvl_tokens is not None else "—")

        # Unstaking period from spotMarketAccounts
        unstaking_days = mkt_data.get("unstaking_period_days")
        unstake_str = f"{unstaking_days}d" if unstaking_days is not None else "—"

        rows.append((symbol or "?", apy, tvl_str, unstake_str, (deposit_address or "")[:8]))

    print(f"\n=== Insurance Fund ({len(rows)} markets) ===")

    col_token = 10
    col_apy = 10
    col_tvl = 16
    col_unstake = 10
    col_addr = 10

    header = (
        "Token".ljust(col_token)
        + "APY %".rjust(col_apy)
        + "TVL".rjust(col_tvl)
        + "Unstake".rjust(col_unstake)
        + "  Vault"
    )
    sep = "-" * (col_token + col_apy + col_tvl + col_unstake + col_addr)
    print(header)
    print(sep)

    for symbol, apy, tvl_str, unstake_str, addr in rows:
        print(
            symbol.ljust(col_token)
            + (_fmt_num(apy) if apy is not None else "—").rjust(col_apy)
            + tvl_str.rjust(col_tvl)
            + unstake_str.rjust(col_unstake)
            + f"  {addr}"
        )

    return market_index_map


def preview_vaults(client: httpx.Client, market_index_map: dict[int, str]) -> None:
    print("\nFetching /stats/vaults ...", flush=True)
    raw = _get("/stats/vaults", client)
    data = _unwrap_vaults(raw)
    if not data:
        print("ERROR: unexpected response format or empty data", file=sys.stderr)
        return

    # Fetch APY data from app.drift.trade
    vault_apys = _fetch_vault_apys(client)

    rows = []
    skipped = 0

    for vault in data:
        net_deposits = _float(vault.get("netDeposits"))
        if net_deposits is None or net_deposits <= 0:
            skipped += 1
            continue

        pubkey = vault.get("pubkey", "")
        if not pubkey:
            skipped += 1
            continue

        spot_market_index = int(vault.get("spotMarketIndex", 0))

        # USDC only (market index 0)
        if spot_market_index != 0:
            skipped += 1
            continue

        tvl_usd = net_deposits
        if tvl_usd < MIN_VAULT_TVL_USD:
            skipped += 1
            continue
        tvl_str = _fmt_int(tvl_usd)

        max_tokens = _float(vault.get("maxTokens"))
        if max_tokens is not None and max_tokens > 0:
            liq_avail = max_tokens - net_deposits
            liq_str = _fmt_int(liq_avail)
        else:
            liq_str = "—"

        permissioned = vault.get("permissioned")
        perm_str = "yes" if permissioned else "no"

        name = f"Drift Vault — USDC ({pubkey[:6]})"

        # APY from app.drift.trade — use 90d
        apy_info = vault_apys.get(pubkey, {})
        apy_90d = apy_info.get("apy_90d")
        apy_str = _fmt_num(apy_90d) if apy_90d is not None else "—"

        rows.append((name[:28], apy_str, tvl_str, liq_str, perm_str, pubkey[:8]))

    print(f"\n=== Vaults ({len(rows)} USDC vaults, {skipped} skipped) ===")

    col_name = 30
    col_apy = 10
    col_tvl = 16
    col_liq = 16
    col_perm = 7
    col_pk = 10

    header = (
        "Name".ljust(col_name)
        + "APY 90d%".rjust(col_apy)
        + "TVL (USDC)".rjust(col_tvl)
        + "Liq Avail".rjust(col_liq)
        + "Perm".rjust(col_perm)
        + "  Pubkey"
    )
    sep = "-" * (col_name + col_apy + col_tvl + col_liq + col_perm + col_pk)
    print(header)
    print(sep)

    for name, apy_str, tvl_str, liq_str, perm_str, pk in rows:
        print(
            name.ljust(col_name)
            + apy_str.rjust(col_apy)
            + tvl_str.rjust(col_tvl)
            + liq_str.rjust(col_liq)
            + perm_str.rjust(col_perm)
            + f"  {pk}"
        )


def main():
    with httpx.Client() as client:
        market_index_map = preview_insurance_fund(client)
        preview_vaults(client, market_index_map)
    print()


if __name__ == "__main__":
    main()
