"""add source_ip and user_agent to audit_events (BL-16 extension)

Revision ID: e17b2d5f9a63
Revises: d16a1c4e8b52
Create Date: 2026-11-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e17b2d5f9a63'
down_revision: Union[str, Sequence[str], None] = 'd16a1c4e8b52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = 'audit_events'


def _columns(bind) -> set:
    insp = sa.inspect(bind)
    if _TABLE not in insp.get_table_names():
        return set()
    return {c['name'] for c in insp.get_columns(_TABLE)}


def upgrade() -> None:
    cols = _columns(op.get_bind())
    if not cols:
        return
    # The SQLite dev-startup backfill may already have added the columns.
    if 'source_ip' not in cols:
        op.add_column(_TABLE, sa.Column('source_ip', sa.String(length=64), nullable=True))
    if 'user_agent' not in cols:
        op.add_column(_TABLE, sa.Column('user_agent', sa.String(length=300), nullable=True))


def downgrade() -> None:
    cols = _columns(op.get_bind())
    to_drop = [c for c in ('user_agent', 'source_ip') if c in cols]
    if not to_drop:
        return
    with op.batch_alter_table(_TABLE) as batch:
        for c in to_drop:
            batch.drop_column(c)
