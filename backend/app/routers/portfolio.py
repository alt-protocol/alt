import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from solders.pubkey import Pubkey
from sqlalchemy import desc, func, text
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.models.base import SessionLocal
from app.models.user_position import TrackedWallet, UserPosition, UserPositionEvent
from app.schemas import (
    TrackedWalletOut,
    UserPositionOut,
    UserPositionHistoryPoint,
    UserPositionEventOut,
    PositionsResponse,
    WalletStatusOut,
)
from app.services.kamino_position_fetcher import fetch_wallet_positions, fetch_wallet_events
from app.services.drift_position_fetcher import fetch_wallet_positions as fetch_drift_positions
from app.services.jupiter_position_fetcher import fetch_wallet_positions as fetch_jupiter_positions

logger = logging.getLogger(__name__)

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

HELIUS_API_KEY = os.getenv("HELIUS_API_KEY", "")


def _validate_wallet(wallet_address: str):
    try:
        Pubkey.from_string(wallet_address)
    except (ValueError, Exception):
        raise HTTPException(status_code=400, detail="Invalid Solana wallet address")


@router.get("/portfolio/{wallet_address}")
@limiter.limit("30/minute")
def get_portfolio(request: Request, wallet_address: str):
    """Read SPL token balances for a wallet via Helius RPC."""
    _validate_wallet(wallet_address)

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


# ---------------------------------------------------------------------------
# User Position Monitoring endpoints
# ---------------------------------------------------------------------------

def _latest_positions(db: Session, wallet_address: str, protocol: str | None = None, product_type: str | None = None):
    """Return the latest snapshot of UserPositions per protocol for a wallet."""
    latest_per_protocol = (
        db.query(
            UserPosition.protocol_slug,
            func.max(UserPosition.snapshot_at).label("latest_at"),
        )
        .filter(UserPosition.wallet_address == wallet_address)
        .group_by(UserPosition.protocol_slug)
        .subquery()
    )
    query = (
        db.query(UserPosition)
        .join(
            latest_per_protocol,
            (UserPosition.protocol_slug == latest_per_protocol.c.protocol_slug)
            & (UserPosition.snapshot_at == latest_per_protocol.c.latest_at)
            & (UserPosition.wallet_address == wallet_address),
        )
    )
    if protocol:
        query = query.filter(UserPosition.protocol_slug == protocol)
    if product_type:
        query = query.filter(UserPosition.product_type == product_type)
    return query.all()


def _store_positions(db: Session, positions: list[dict], now: datetime):
    """Store a list of position dicts as UserPosition rows."""
    from app.services.utils import store_position_rows
    store_position_rows(db, positions, now)


def _fetch_protocol(name: str, fetch_fn, wallet_address: str) -> list[dict] | None:
    db_local = SessionLocal()
    try:
        return fetch_fn(wallet_address, db_local)["positions"]
    except Exception as exc:
        logger.warning("%s fetch failed for %s: %s", name, wallet_address[:8], exc)
        return None
    finally:
        db_local.close()


def _background_fetch_and_store(wallet_address: str):
    """Background worker: fetch Kamino + Drift + Jupiter positions in parallel and store as snapshot."""
    db: Session = SessionLocal()
    try:
        tracked = (
            db.query(TrackedWallet)
            .filter(TrackedWallet.wallet_address == wallet_address)
            .first()
        )
        if not tracked:
            return
        tracked.fetch_status = "fetching"
        db.commit()

        now = datetime.now(timezone.utc)
        all_positions: list[dict] = []

        with ThreadPoolExecutor(max_workers=3) as executor:
            futures = [
                executor.submit(_fetch_protocol, "Kamino", fetch_wallet_positions, wallet_address),
                executor.submit(_fetch_protocol, "Drift", fetch_drift_positions, wallet_address),
                executor.submit(_fetch_protocol, "Jupiter", fetch_jupiter_positions, wallet_address),
            ]
            for future in as_completed(futures):
                result = future.result()
                if result is not None:
                    all_positions.extend(result)

        if not all_positions:
            logger.warning("All fetches failed for %s — keeping old snapshot", wallet_address[:8])
            tracked.fetch_status = "ready"
            db.commit()
            return

        _store_positions(db, all_positions, now)

        tracked.last_fetched_at = now
        tracked.fetch_status = "ready"
        db.commit()
        logger.info("Background fetch complete for %s: %d positions", wallet_address[:8], len(all_positions))

    except Exception as exc:
        logger.error("Background fetch failed for %s: %s", wallet_address[:8], exc)
        db.rollback()
        try:
            tracked = (
                db.query(TrackedWallet)
                .filter(TrackedWallet.wallet_address == wallet_address)
                .first()
            )
            if tracked:
                tracked.fetch_status = "error"
                db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()


@router.post("/portfolio/{wallet_address}/track")
@limiter.limit("5/minute")
def track_wallet(
    request: Request,
    wallet_address: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Register a wallet for tracking. Returns immediately; fetch runs in background."""
    _validate_wallet(wallet_address)

    # Upsert TrackedWallet
    wallet = (
        db.query(TrackedWallet)
        .filter(TrackedWallet.wallet_address == wallet_address)
        .first()
    )
    if wallet:
        wallet.is_active = True
    else:
        wallet = TrackedWallet(wallet_address=wallet_address)
        db.add(wallet)
    db.flush()

    # Check if we already have positions from a prior snapshot
    has_positions = (
        db.query(UserPosition.id)
        .filter(UserPosition.wallet_address == wallet_address)
        .first()
    )
    if has_positions:
        # Return cached positions (latest per protocol), refresh in background
        positions = _latest_positions(db, wallet_address)
        position_dicts = [
            {
                "wallet_address": p.wallet_address,
                "protocol_slug": p.protocol_slug,
                "product_type": p.product_type,
                "external_id": p.external_id,
                "opportunity_id": p.opportunity_id,
                "deposit_amount": float(p.deposit_amount) if p.deposit_amount else None,
                "deposit_amount_usd": float(p.deposit_amount_usd) if p.deposit_amount_usd else None,
                "pnl_usd": float(p.pnl_usd) if p.pnl_usd else None,
                "pnl_pct": float(p.pnl_pct) if p.pnl_pct else None,
                "initial_deposit_usd": float(p.initial_deposit_usd) if p.initial_deposit_usd else None,
                "opened_at": p.opened_at.isoformat() if p.opened_at else None,
                "held_days": float(p.held_days) if p.held_days else None,
                "apy": float(p.apy) if p.apy else None,
                "is_closed": p.is_closed,
                "closed_at": p.closed_at.isoformat() if p.closed_at else None,
                "close_value_usd": float(p.close_value_usd) if p.close_value_usd else None,
                "token_symbol": p.token_symbol,
                "extra_data": p.extra_data,
            }
            for p in positions
        ]
        total_value = sum(float(p.deposit_amount_usd or 0) for p in positions)
        total_pnl = sum(float(p.pnl_usd or 0) for p in positions if p.pnl_usd is not None)

        wallet.fetch_status = "fetching"
        db.commit()
        background_tasks.add_task(_background_fetch_and_store, wallet_address)

        return {
            "wallet": wallet_address,
            "positions": position_dicts,
            "summary": {
                "total_value_usd": total_value,
                "total_pnl_usd": total_pnl,
                "position_count": len(position_dicts),
            },
            "fetch_status": "ready",
        }

    # No prior data — kick off background fetch, return empty
    wallet.fetch_status = "fetching"
    db.commit()
    background_tasks.add_task(_background_fetch_and_store, wallet_address)

    return {
        "wallet": wallet_address,
        "positions": [],
        "summary": {
            "total_value_usd": 0,
            "total_pnl_usd": 0,
            "position_count": 0,
        },
        "fetch_status": "fetching",
    }


@router.get("/portfolio/{wallet_address}/status", response_model=WalletStatusOut)
@limiter.limit("60/minute")
def get_wallet_status(request: Request, wallet_address: str, db: Session = Depends(get_db)):
    """Return fetch status for a tracked wallet (for frontend polling)."""
    _validate_wallet(wallet_address)
    tracked = (
        db.query(TrackedWallet)
        .filter(TrackedWallet.wallet_address == wallet_address)
        .first()
    )
    if not tracked:
        raise HTTPException(status_code=404, detail="Wallet not tracked")
    return tracked


@router.get("/portfolio/{wallet_address}/positions", response_model=list[UserPositionOut])
@limiter.limit("60/minute")
def get_positions(
    request: Request,
    wallet_address: str,
    protocol: Optional[str] = Query(None),
    product_type: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """Return the latest snapshot of positions from DB."""
    _validate_wallet(wallet_address)
    return _latest_positions(db, wallet_address, protocol, product_type)


@router.get("/portfolio/{wallet_address}/positions/history")
@limiter.limit("60/minute")
def get_position_history(
    request: Request,
    wallet_address: str,
    period: str = Query("7d", pattern="^(7d|30d|90d)$"),
    external_id: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Return time-series position snapshots for PnL charts."""
    _validate_wallet(wallet_address)

    days = {"7d": 7, "30d": 30, "90d": 90}[period]
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # Per-position history (single position, low row count)
    if external_id:
        rows = (
            db.query(UserPosition)
            .filter(
                UserPosition.wallet_address == wallet_address,
                UserPosition.snapshot_at >= cutoff,
                UserPosition.external_id == external_id,
            )
            .order_by(UserPosition.snapshot_at)
            .offset(offset)
            .limit(limit)
            .all()
        )
        return [
            UserPositionHistoryPoint(
                snapshot_at=r.snapshot_at,
                deposit_amount_usd=float(r.deposit_amount_usd) if r.deposit_amount_usd else None,
                pnl_usd=float(r.pnl_usd) if r.pnl_usd else None,
                pnl_pct=float(r.pnl_pct) if r.pnl_pct else None,
            )
            for r in rows
        ]

    # Aggregate view — bucket by time interval to keep chart data small
    bucket_interval = {"7d": "1 hour", "30d": "4 hours", "90d": "12 hours"}[period]

    # Step 1: sum all positions per snapshot timestamp
    per_snapshot = (
        db.query(
            UserPosition.snapshot_at,
            func.sum(UserPosition.deposit_amount_usd).label("total_usd"),
            func.sum(UserPosition.pnl_usd).label("total_pnl"),
        )
        .filter(
            UserPosition.wallet_address == wallet_address,
            UserPosition.snapshot_at >= cutoff,
        )
        .group_by(UserPosition.snapshot_at)
        .subquery()
    )

    # Step 2: pick the latest snapshot per time bucket via DISTINCT ON
    bucket_expr = func.date_bin(
        text(f"'{bucket_interval}'"), per_snapshot.c.snapshot_at, cutoff,
    )

    rows = (
        db.query(
            bucket_expr.label("bucket"),
            per_snapshot.c.total_usd.label("deposit_amount_usd"),
            per_snapshot.c.total_pnl.label("pnl_usd"),
        )
        .distinct(bucket_expr)
        .order_by(bucket_expr, per_snapshot.c.snapshot_at.desc())
        .all()
    )

    return [
        UserPositionHistoryPoint(
            snapshot_at=row.bucket,
            deposit_amount_usd=float(row.deposit_amount_usd) if row.deposit_amount_usd else 0.0,
            pnl_usd=float(row.pnl_usd) if row.pnl_usd else 0.0,
            pnl_pct=None,
        )
        for row in rows
    ]


@router.get("/portfolio/{wallet_address}/events", response_model=list[UserPositionEventOut])
@limiter.limit("60/minute")
def get_events(
    request: Request,
    wallet_address: str,
    protocol: Optional[str] = Query(None),
    product_type: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    """Return deposit/withdraw event history."""
    _validate_wallet(wallet_address)

    query = db.query(UserPositionEvent).filter(
        UserPositionEvent.wallet_address == wallet_address,
    )
    if protocol:
        query = query.filter(UserPositionEvent.protocol_slug == protocol)
    if product_type:
        query = query.filter(UserPositionEvent.product_type == product_type)

    return query.order_by(desc(UserPositionEvent.event_at)).limit(limit).all()
