from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ProtocolOut(BaseModel):
    id: int
    slug: str
    name: str
    description: Optional[str]
    website_url: Optional[str]
    logo_url: Optional[str]
    audit_status: Optional[str]
    auditors: Optional[list[str]]
    integration: str

    model_config = {"from_attributes": True}


class YieldOpportunityListOut(BaseModel):
    id: int
    protocol_id: int
    external_id: Optional[str]
    name: str
    category: str
    tokens: list[str]
    apy_current: Optional[float]
    apy_7d_avg: Optional[float]
    apy_30d_avg: Optional[float]
    tvl_usd: Optional[float]
    min_deposit: Optional[float]
    lock_period_days: int
    risk_tier: Optional[str]
    protocol_name: Optional[str] = None
    is_active: bool
    max_leverage: Optional[float] = None
    utilization_pct: Optional[float] = None
    liquidity_available_usd: Optional[float] = None
    is_automated: Optional[bool] = None
    depeg: Optional[float] = None
    protocol_url: Optional[str] = None
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


# Backward-compat alias
YieldOpportunityOut = YieldOpportunityListOut


class YieldHistoryPoint(BaseModel):
    snapshot_at: datetime
    apy: Optional[float]
    tvl_usd: Optional[float]

    model_config = {"from_attributes": True}


class YieldOpportunityDetailOut(YieldOpportunityListOut):
    extra_data: Optional[dict] = None
    deposit_address: Optional[str] = None
    protocol: Optional[ProtocolOut] = None
    recent_snapshots: list[YieldHistoryPoint] = []


class PortfolioPosition(BaseModel):
    mint: str
    symbol: Optional[str]
    amount: float
    decimals: int
    ui_amount: float


class PortfolioOut(BaseModel):
    wallet: str
    positions: list[PortfolioPosition]
    total_value_usd: float


# ---------------------------------------------------------------------------
# User Position Monitoring
# ---------------------------------------------------------------------------

class TrackedWalletOut(BaseModel):
    wallet_address: str
    first_seen_at: datetime
    last_fetched_at: Optional[datetime]
    is_active: bool
    fetch_status: str = "pending"

    model_config = {"from_attributes": True}


class WalletStatusOut(BaseModel):
    wallet_address: str
    fetch_status: str
    last_fetched_at: Optional[datetime]

    model_config = {"from_attributes": True}


class UserPositionOut(BaseModel):
    id: int
    wallet_address: str
    protocol_slug: str
    product_type: str
    external_id: str
    opportunity_id: Optional[int]
    deposit_amount: Optional[float]
    deposit_amount_usd: Optional[float]
    pnl_usd: Optional[float]
    pnl_pct: Optional[float]
    initial_deposit_usd: Optional[float] = None
    opened_at: Optional[datetime] = None
    held_days: Optional[float] = None
    apy: Optional[float] = None
    is_closed: Optional[bool] = None
    closed_at: Optional[datetime] = None
    close_value_usd: Optional[float] = None
    token_symbol: Optional[str] = None
    extra_data: Optional[dict] = None
    snapshot_at: datetime

    model_config = {"from_attributes": True}


class UserPositionHistoryPoint(BaseModel):
    snapshot_at: datetime
    deposit_amount_usd: Optional[float]
    pnl_usd: Optional[float]
    pnl_pct: Optional[float]


class UserPositionEventOut(BaseModel):
    id: int
    wallet_address: str
    protocol_slug: str
    product_type: str
    external_id: str
    event_type: str
    amount: Optional[float]
    amount_usd: Optional[float]
    tx_signature: Optional[str]
    event_at: datetime
    extra_data: Optional[dict] = None

    model_config = {"from_attributes": True}


class PositionsSummary(BaseModel):
    total_value_usd: float
    total_pnl_usd: float
    position_count: int


class PositionsResponse(BaseModel):
    wallet: str
    positions: list[dict]
    summary: PositionsSummary
