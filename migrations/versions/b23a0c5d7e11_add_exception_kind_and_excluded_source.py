"""add findings.exception_kind and 'acknowledged' memory source (BL-23)

Revision ID: b23a0c5d7e11
Revises: 48749912a976
Create Date: 2026-11-05 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from backend.services.sqlite_schema import set_memory_source_check


# revision identifiers, used by Alembic.
revision: str = 'b23a0c5d7e11'
down_revision: Union[str, Sequence[str], None] = '48749912a976'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    # NULL or 'exclude' = legacy exception (stays in the PDF as an exclusion banner); 'acknowledge' = hidden entirely from the PDF.
    if not _column_exists(bind, 'findings', 'exception_kind'):
        op.add_column('findings', sa.Column('exception_kind', sa.String(length=20), nullable=True))
    if bind.dialect.name == 'postgresql':
        op.drop_constraint('ck_memory_source', 'product_memory_entries', type_='check')
        op.create_check_constraint(
            'ck_memory_source', 'product_memory_entries',
            "source IN ('excepted','deleted','temp_excepted','acknowledged')"
        )
    elif bind.dialect.name == 'sqlite':
        set_memory_source_check(bind, allow_acknowledged=True)


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        # Acknowledged entries degrade to plain exceptions so the narrower CHECK holds.
        op.execute("UPDATE product_memory_entries SET source='excepted' WHERE source='acknowledged'")
        op.drop_constraint('ck_memory_source', 'product_memory_entries', type_='check')
        op.create_check_constraint(
            'ck_memory_source', 'product_memory_entries',
            "source IN ('excepted','deleted','temp_excepted')"
        )
    elif bind.dialect.name == 'sqlite':
        set_memory_source_check(bind, allow_acknowledged=False)
    if _column_exists(bind, 'findings', 'exception_kind'):
        with op.batch_alter_table('findings') as batch:
            batch.drop_column('exception_kind')
