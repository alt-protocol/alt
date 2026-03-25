from sqlalchemy import Column, Index, Integer, String, Numeric, Boolean, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from app.models.base import Base


class TrackedWallet(Base):
    __tablename__ = "tracked_wallets"

    id = Column(Integer, primary_key=True)
    wallet_address = Column(String(255), unique=True, nullable=False, index=True)
    first_seen_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)
    last_fetched_at = Column(TIMESTAMP, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False, server_default="true")
    fetch_status = Column(String(20), nullable=False, server_default="pending")


class UserPosition(Base):
    __tablename__ = "user_positions"

    id = Column(Integer, primary_key=True)
    wallet_address = Column(String(255), nullable=False)
    protocol_slug = Column(String(50), nullable=False)
    product_type = Column(String(50), nullable=False)
    external_id = Column(String(255), nullable=False)
    opportunity_id = Column(Integer, nullable=True)
    deposit_amount = Column(Numeric(30, 10))
    deposit_amount_usd = Column(Numeric(20, 2))
    pnl_usd = Column(Numeric(20, 2), nullable=True)
    pnl_pct = Column(Numeric(10, 4), nullable=True)
    initial_deposit_usd = Column(Numeric(20, 2), nullable=True)
    opened_at = Column(TIMESTAMP, nullable=True)
    held_days = Column(Numeric(10, 4), nullable=True)
    apy = Column(Numeric(10, 4), nullable=True)
    is_closed = Column(Boolean, nullable=True)
    closed_at = Column(TIMESTAMP, nullable=True)
    close_value_usd = Column(Numeric(20, 2), nullable=True)
    token_symbol = Column(String(50), nullable=True)
    extra_data = Column(JSONB)
    snapshot_at = Column(TIMESTAMP, nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        Index("ix_user_positions_wallet_snapshot", "wallet_address", "snapshot_at"),
        Index("ix_user_positions_wallet_external", "wallet_address", "external_id"),
        Index("ix_user_positions_wallet_protocol", "wallet_address", "protocol_slug"),
    )


class UserPositionEvent(Base):
    __tablename__ = "user_position_events"

    id = Column(Integer, primary_key=True)
    wallet_address = Column(String(255), nullable=False, index=True)
    protocol_slug = Column(String(50), nullable=False)
    product_type = Column(String(50), nullable=False)
    external_id = Column(String(255), nullable=False)
    event_type = Column(String(50), nullable=False)
    amount = Column(Numeric(30, 10))
    amount_usd = Column(Numeric(20, 2), nullable=True)
    tx_signature = Column(String(255), nullable=True, unique=True)
    event_at = Column(TIMESTAMP, nullable=False)
    extra_data = Column(JSONB)

    __table_args__ = ()
