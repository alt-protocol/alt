from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.models.yield_opportunity import YieldOpportunity, YieldSnapshot
from app.schemas import YieldOpportunityOut, YieldHistoryPoint

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

    if sort == SortOrder.APY_DESC:
        q = q.order_by(YieldOpportunity.apy_current.desc().nullslast())
    elif sort == SortOrder.APY_ASC:
        q = q.order_by(YieldOpportunity.apy_current.asc().nullsfirst())
    elif sort == SortOrder.TVL_DESC:
        q = q.order_by(YieldOpportunity.tvl_usd.desc().nullslast())
    elif sort == SortOrder.TVL_ASC:
        q = q.order_by(YieldOpportunity.tvl_usd.asc().nullsfirst())

    results = q.all()
    last_updated = max((r.updated_at for r in results if r.updated_at), default=None)

    return {
        "data": [YieldOpportunityOut.model_validate(r) for r in results],
        "meta": {"total": len(results), "last_updated": last_updated},
    }


@router.get("/yields/{yield_id}/history", response_model=dict)
def get_yield_history(
    yield_id: int,
    period: str = Query("7d"),
    db: Session = Depends(get_db),
):
    if not db.query(YieldOpportunity).filter(YieldOpportunity.id == yield_id).first():
        raise HTTPException(status_code=404, detail="Yield opportunity not found")

    days = PERIOD_DAYS.get(period, 7)
    since = datetime.now(timezone.utc) - timedelta(days=days)

    snapshots = (
        db.query(YieldSnapshot)
        .filter(
            YieldSnapshot.opportunity_id == yield_id,
            YieldSnapshot.snapshot_at >= since,
        )
        .order_by(YieldSnapshot.snapshot_at.asc())
        .all()
    )

    return {"data": [YieldHistoryPoint.model_validate(s) for s in snapshots]}
