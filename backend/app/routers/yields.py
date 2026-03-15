from fastapi import APIRouter, Query
from typing import Optional

router = APIRouter()


@router.get("/yields")
def get_yields(
    category: Optional[str] = Query(None),
    sort: Optional[str] = Query("apy_desc"),
    tokens: Optional[str] = Query(None),
):
    # TODO: query yield_opportunities from DB
    return {"data": [], "meta": {"total": 0, "last_updated": None}}


@router.get("/yields/{yield_id}/history")
def get_yield_history(yield_id: int, period: str = "7d"):
    # TODO: query yield_snapshots from DB
    return {"data": []}
