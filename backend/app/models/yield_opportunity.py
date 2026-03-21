from sqlalchemy import Column, Index, Integer, String, Numeric, Boolean, ForeignKey, Text, TIMESTAMP, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class YieldOpportunity(Base):
    __tablename__ = "yield_opportunities"

    id = Column(Integer, primary_key=True)
    protocol_id = Column(Integer, ForeignKey("protocols.id", ondelete="CASCADE"), nullable=False)
    external_id = Column(String(255), unique=True, index=True)
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
    protocol_name = Column(String(100))
    is_active = Column(Boolean, default=True, nullable=False, server_default="true")
    extra_data = Column(JSONB)
    max_leverage = Column(Numeric(6, 2))
    utilization_pct = Column(Numeric(6, 2))
    liquidity_available_usd = Column(Numeric(20, 2))
    is_automated = Column(Boolean)
    depeg = Column(Numeric(10, 6))
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    protocol = relationship("Protocol", back_populates="opportunities")
    snapshots = relationship("YieldSnapshot", back_populates="opportunity")

    __table_args__ = (
        Index("ix_yield_opportunities_protocol_id", "protocol_id"),
        UniqueConstraint("protocol_id", "external_id", name="uq_yield_opportunities_protocol_external"),
    )


class YieldSnapshot(Base):
    __tablename__ = "yield_snapshots"

    id = Column(Integer, primary_key=True)
    opportunity_id = Column(Integer, ForeignKey("yield_opportunities.id", ondelete="CASCADE"), nullable=False)
    apy = Column(Numeric(10, 4))
    tvl_usd = Column(Numeric(20, 2))
    snapshot_at = Column(TIMESTAMP, nullable=False)
    source = Column(String(50))

    opportunity = relationship("YieldOpportunity", back_populates="snapshots")

    __table_args__ = (
        Index("ix_yield_snapshots_opp_snapshot", "opportunity_id", "snapshot_at"),
        Index("ix_yield_snapshots_snapshot_at", "snapshot_at"),
    )
