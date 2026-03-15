from sqlalchemy import Column, Integer, String, Numeric, Boolean, ForeignKey, ARRAY, Text, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.models.base import Base


class YieldOpportunity(Base):
    __tablename__ = "yield_opportunities"

    id = Column(Integer, primary_key=True)
    protocol_id = Column(Integer, ForeignKey("protocols.id"))
    external_id = Column(String(255))
    name = Column(String(200), nullable=False)
    category = Column(String(50), nullable=False)
    tokens = Column(ARRAY(Text), nullable=False)
    apy_current = Column(Numeric(10, 4))
    apy_7d_avg = Column(Numeric(10, 4))
    apy_30d_avg = Column(Numeric(10, 4))
    tvl_usd = Column(Numeric(20, 2))
    min_deposit = Column(Numeric(20, 6))
    lock_period_days = Column(Integer, default=0)
    risk_tier = Column(String(20))
    deposit_address = Column(String(255))
    is_active = Column(Boolean, default=True)
    metadata = Column(JSONB)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


class YieldSnapshot(Base):
    __tablename__ = "yield_snapshots"

    id = Column(Integer, primary_key=True)
    opportunity_id = Column(Integer, ForeignKey("yield_opportunities.id"))
    apy = Column(Numeric(10, 4))
    tvl_usd = Column(Numeric(20, 2))
    snapshot_at = Column(TIMESTAMP, nullable=False)
    source = Column(String(50))
