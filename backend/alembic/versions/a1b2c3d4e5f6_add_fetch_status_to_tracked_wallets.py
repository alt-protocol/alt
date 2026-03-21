"""add fetch_status to tracked_wallets

Revision ID: a1b2c3d4e5f6
Revises: e651e12dc8d6
Create Date: 2026-03-21 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'e651e12dc8d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add fetch_status column to tracked_wallets."""
    op.add_column(
        'tracked_wallets',
        sa.Column('fetch_status', sa.String(20), nullable=False, server_default='pending'),
    )


def downgrade() -> None:
    """Remove fetch_status column."""
    op.drop_column('tracked_wallets', 'fetch_status')
