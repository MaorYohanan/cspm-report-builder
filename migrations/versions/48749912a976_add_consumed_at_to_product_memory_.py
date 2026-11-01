"""add consumed_at to product_memory_entries

Revision ID: 48749912a976
Revises: 022100960028
Create Date: 2026-10-29 11:01:01.405911

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '48749912a976'
down_revision: Union[str, Sequence[str], None] = '022100960028'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add consumed_at column to product_memory_entries for BL-12 temp action lifecycle tracking
    op.add_column('product_memory_entries', sa.Column('consumed_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    # Remove consumed_at column from product_memory_entries
    op.drop_column('product_memory_entries', 'consumed_at')
