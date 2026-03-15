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


class YieldOpportunityOut(BaseModel):
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
    is_active: bool
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}


class YieldHistoryPoint(BaseModel):
    snapshot_at: datetime
    apy: Optional[float]
    tvl_usd: Optional[float]

    model_config = {"from_attributes": True}


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
