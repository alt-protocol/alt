import os

import httpx
from fastapi import APIRouter, HTTPException
from solders.pubkey import Pubkey

router = APIRouter()

HELIUS_API_KEY = os.getenv("HELIUS_API_KEY", "")


@router.get("/portfolio/{wallet_address}")
def get_portfolio(wallet_address: str):
    """Read SPL token balances for a wallet via Helius RPC."""
    try:
        Pubkey.from_string(wallet_address)
    except (ValueError, Exception):
        raise HTTPException(status_code=400, detail="Invalid Solana wallet address")

    if not HELIUS_API_KEY:
        raise HTTPException(status_code=503, detail="Helius API key not configured")

    url = f"https://mainnet.helius-rpc.com/?api-key={HELIUS_API_KEY}"

    try:
        resp = httpx.post(
            url,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getTokenAccountsByOwner",
                "params": [
                    wallet_address,
                    {"programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
                    {"encoding": "jsonParsed"},
                ],
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Helius RPC error: {exc}")

    if "error" in data:
        raise HTTPException(status_code=502, detail=data["error"].get("message", "RPC error"))

    accounts = data.get("result", {}).get("value", [])
    positions = []

    for account in accounts:
        info = account.get("account", {}).get("data", {}).get("parsed", {}).get("info", {})
        mint = info.get("mint", "")
        token_amount = info.get("tokenAmount", {})
        amount = token_amount.get("amount", "0")
        decimals = token_amount.get("decimals", 0)
        ui_amount = token_amount.get("uiAmount") or 0

        if ui_amount > 0:
            positions.append({
                "mint": mint,
                "symbol": None,
                "amount": float(amount),
                "decimals": decimals,
                "ui_amount": ui_amount,
            })

    return {"wallet": wallet_address, "positions": positions, "total_value_usd": 0}
