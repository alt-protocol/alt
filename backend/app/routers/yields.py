from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, or_, func, text
from sqlalchemy.orm import Session, joinedload

from app.config.stablecoins import STABLECOIN_SYMBOLS
from app.dependencies import get_db
from app.models.yield_opportunity import YieldOpportunity, YieldSnapshot
from app.schemas import YieldOpportunityListOut, YieldOpportunityDetailOut, YieldHistoryPoint, ProtocolOut

router = APIRouter()


class SortOrder(str, Enum):
    APY_DESC = "apy_desc"
    APY_ASC = "apy_asc"
    TVL_DESC = "tvl_desc"
    TVL_ASC = "tvl_asc"


PERIOD_DAYS = {"7d": 7, "30d": 30, "90d": 90}


@router.get("/yields", response_model=dict)
def get_yields(
    category: Optional[str] = Query(None),
    sort: SortOrder = Query(SortOrder.APY_DESC),
    tokens: Optional[str] = Query(None),
    vault_tag: Optional[str] = Query(None),
    stablecoins_only: bool = Query(False),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(YieldOpportunity).filter(YieldOpportunity.is_active == True)  # noqa: E712

    if category:
        q = q.filter(YieldOpportunity.category == category)

    if vault_tag:
        q = q.filter(YieldOpportunity.extra_data["vault_tag"].astext == vault_tag)

    if tokens:
        token_list = [t.strip() for t in tokens.split(",")]
        q = q.filter(YieldOpportunity.tokens.overlap(token_list))

    if stablecoins_only:
        q = q.filter(YieldOpportunity.apy_current > 0)
        q = q.filter(
            or_(
                # Multiply: only stable/rwa loops (excludes JLP, SOL, BONKSOL directional pairs)
                and_(
                    YieldOpportunity.category == "multiply",
                    YieldOpportunity.extra_data["vault_tag"].astext.in_(
                        ["stable_loop", "rwa_loop"]
                    ),
                ),
                # Non-multiply (lending, vault, etc.): at least one stablecoin token
                and_(
                    YieldOpportunity.category != "multiply",
                    YieldOpportunity.tokens.overlap(list(STABLECOIN_SYMBOLS)),
                ),
                # PT-* tokens (Exponent principal tokens — fixed yield, stablecoin exposure)
                func.exists(
                    text(
                        "SELECT 1 FROM unnest(yield_opportunities.tokens) AS t"
                        " WHERE t LIKE 'PT-%'"
                    )
                ),
            )
        )

    if sort == SortOrder.APY_DESC:
        q = q.order_by(YieldOpportunity.apy_current.desc().nullslast())
    elif sort == SortOrder.APY_ASC:
        q = q.order_by(YieldOpportunity.apy_current.asc().nullsfirst())
    elif sort == SortOrder.TVL_DESC:
        q = q.order_by(YieldOpportunity.tvl_usd.desc().nullslast())
    elif sort == SortOrder.TVL_ASC:
        q = q.order_by(YieldOpportunity.tvl_usd.asc().nullsfirst())

    count_col = func.count().over().label("_total")
    rows = q.add_columns(count_col).offset(offset).limit(limit).all()
    total = rows[0][1] if rows else 0
    results = [row[0] for row in rows]
    last_updated = max((r.updated_at for r in results if r.updated_at), default=None)

    items = []
    for r in results:
        item = YieldOpportunityListOut.model_validate(r)
        if r.extra_data:
            item.protocol_url = r.extra_data.get("protocol_url")
        items.append(item)

    return {
        "data": items,
        "meta": {"total": total, "last_updated": last_updated, "limit": limit, "offset": offset},
    }


@router.get("/yields/{yield_id}", response_model=YieldOpportunityDetailOut)
def get_yield_detail(
    yield_id: int,
    db: Session = Depends(get_db),
):
    opp = db.query(YieldOpportunity).options(joinedload(YieldOpportunity.protocol)).filter(YieldOpportunity.id == yield_id).first()
    if not opp:
        raise HTTPException(status_code=404, detail="Yield opportunity not found")

    since = datetime.now(timezone.utc) - timedelta(days=7)
    snapshots = (
        db.query(YieldSnapshot)
        .filter(
            YieldSnapshot.opportunity_id == yield_id,
            YieldSnapshot.snapshot_at >= since,
        )
        .order_by(YieldSnapshot.snapshot_at.asc())
        .all()
    )

    item = YieldOpportunityListOut.model_validate(opp)
    if opp.extra_data:
        item.protocol_url = opp.extra_data.get("protocol_url")
    data = item.model_dump()
    data["extra_data"] = opp.extra_data
    data["deposit_address"] = opp.deposit_address
    data["protocol"] = ProtocolOut.model_validate(opp.protocol) if opp.protocol else None
    data["recent_snapshots"] = [YieldHistoryPoint.model_validate(s) for s in snapshots]

    return YieldOpportunityDetailOut(**data)


@router.get("/yields/{yield_id}/history", response_model=dict)
def get_yield_history(
    yield_id: int,
    period: str = Query("7d"),
    limit: int = Query(500, ge=1, le=2000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    if not db.query(YieldOpportunity).filter(YieldOpportunity.id == yield_id).first():
        raise HTTPException(status_code=404, detail="Yield opportunity not found")

    days = PERIOD_DAYS.get(period, 7)
    since = datetime.now(timezone.utc) - timedelta(days=days)

    q = (
        db.query(YieldSnapshot)
        .filter(
            YieldSnapshot.opportunity_id == yield_id,
            YieldSnapshot.snapshot_at >= since,
        )
        .order_by(YieldSnapshot.snapshot_at.asc())
    )

    total = q.count()
    snapshots = q.offset(offset).limit(limit).all()

    return {
        "data": [YieldHistoryPoint.model_validate(s) for s in snapshots],
        "meta": {"total": total, "limit": limit, "offset": offset},
    }
