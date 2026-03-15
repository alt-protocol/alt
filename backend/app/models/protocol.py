from sqlalchemy import Column, Integer, String, Date, ARRAY, Text, TIMESTAMP
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.models.base import Base


class Protocol(Base):
    __tablename__ = "protocols"

    id = Column(Integer, primary_key=True)
    slug = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text)
    website_url = Column(String(255))
    logo_url = Column(String(255))
    audit_status = Column(String(50))
    auditors = Column(ARRAY(Text))
    launched_at = Column(Date)
    integration = Column(String(20), default="data_only", server_default="data_only")
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    opportunities = relationship("YieldOpportunity", back_populates="protocol")
