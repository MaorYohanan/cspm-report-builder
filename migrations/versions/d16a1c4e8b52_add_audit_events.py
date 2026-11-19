"""add audit_events table (BL-16)

Revision ID: d16a1c4e8b52
Revises: c24b7e9f1a30
Create Date: 2026-11-17 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd16a1c4e8b52'
down_revision: Union[str, Sequence[str], None] = 'c24b7e9f1a30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = 'audit_events'


def _table_exists(bind) -> bool:
    return _TABLE in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    # The SQLite dev-startup backfill may already have created the table.
    if _table_exists(bind):
        return
    op.create_table(
        _TABLE,
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('timestamp', sa.DateTime(), nullable=False),
        sa.Column('actor', sa.String(length=254), nullable=False),
        sa.Column('actor_role', sa.String(length=20), nullable=False),
        sa.Column('action', sa.String(length=60), nullable=False),
        sa.Column('entity_type', sa.String(length=40), nullable=False),
        sa.Column('entity_id', sa.String(length=300), nullable=True),
        sa.Column('product_id', sa.String(length=100), nullable=True),
        sa.Column('details', sa.Text(), nullable=True),
    )
    op.create_index('ix_audit_events_timestamp', _TABLE, ['timestamp'])
    op.create_index('ix_audit_events_actor', _TABLE, ['actor'])
    op.create_index('ix_audit_events_action', _TABLE, ['action'])
    op.create_index('ix_audit_events_product_id', _TABLE, ['product_id'])


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind):
        return
    for name in ('ix_audit_events_product_id', 'ix_audit_events_action',
                 'ix_audit_events_actor', 'ix_audit_events_timestamp'):
        op.drop_index(name, table_name=_TABLE)
    op.drop_table(_TABLE)
