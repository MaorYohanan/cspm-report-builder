"""add temp_excepted source value to product memory

Revision ID: 022100960028
Revises: 
Create Date: 2026-10-28 13:42:14.835486

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '022100960028'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # For PostgreSQL: drop old CHECK constraint and create new one
    # For SQLite: constraint is in table definition, no ALTER needed
    connection = op.get_bind()
    if connection.dialect.name == 'postgresql':
        op.drop_constraint('ck_memory_source', 'product_memory_entries', type_='check')
        op.create_check_constraint(
            'ck_memory_source',
            'product_memory_entries',
            "source IN ('excepted','deleted','temp_excepted')"
        )


def downgrade() -> None:
    """Downgrade schema."""
    connection = op.get_bind()
    if connection.dialect.name == 'postgresql':
        op.drop_constraint('ck_memory_source', 'product_memory_entries', type_='check')
        op.create_check_constraint(
            'ck_memory_source',
            'product_memory_entries',
            "source IN ('excepted','deleted')"
        )
