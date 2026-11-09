"""add product_memory_entries.rule_key (BL-24)

Revision ID: c24b7e9f1a30
Revises: b23a0c5d7e11
Create Date: 2026-11-09 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c24b7e9f1a30'
down_revision: Union[str, Sequence[str], None] = 'b23a0c5d7e11'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = 'product_memory_entries'
_INDEX = 'ix_memory_product_rule_key'


def _column_exists(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _index_exists(bind, table: str, name: str) -> bool:
    return name in {i["name"] for i in sa.inspect(bind).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    # The SQLite dev-startup backfill may already have added the column/index.
    if not _column_exists(bind, _TABLE, 'rule_key'):
        op.add_column(_TABLE, sa.Column('rule_key', sa.String(length=300), nullable=True))
    if not _index_exists(bind, _TABLE, _INDEX):
        op.create_index(_INDEX, _TABLE, ['product_id', 'rule_key'])


def downgrade() -> None:
    bind = op.get_bind()
    if _index_exists(bind, _TABLE, _INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)
    if _column_exists(bind, _TABLE, 'rule_key'):
        with op.batch_alter_table(_TABLE) as batch:
            batch.drop_column('rule_key')
