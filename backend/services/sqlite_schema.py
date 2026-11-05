"""SQLite schema helpers for changes SQLite cannot ALTER in place.

SQLite stores CHECK constraints inside the table definition, so widening
``ck_memory_source`` on an existing database requires rebuilding the table.
Used by both the dev-startup backfill in ``app.py`` and the Alembic migration.
"""
from __future__ import annotations

import logging

from sqlalchemy import text

_log = logging.getLogger(__name__)

_TABLE = "product_memory_entries"
_OLD_VARIANTS = (
    "'excepted','deleted','temp_excepted'",
    "'excepted','deleted'",
)
_FULL = "'excepted','deleted','temp_excepted','acknowledged'"
_BASE = "'excepted','deleted','temp_excepted'"


def _rebuild_memory_table(conn, new_sql: str, index_sqls: list[str]) -> None:
    """Rebuild product_memory_entries with ``new_sql``, preserving rows and indexes."""
    cols = [r[1] for r in conn.execute(text(f"PRAGMA table_info({_TABLE})")).fetchall()]
    col_list = ", ".join(f'"{c}"' for c in cols)
    old_idx = [r[0] for r in conn.execute(text(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=:t AND sql IS NOT NULL"
    ), {"t": _TABLE}).fetchall()]
    for name in old_idx:
        conn.execute(text(f'DROP INDEX "{name}"'))
    conn.execute(text(f'ALTER TABLE {_TABLE} RENAME TO "_{_TABLE}_old"'))
    conn.execute(text(new_sql))
    conn.execute(text(f'INSERT INTO {_TABLE} ({col_list}) SELECT {col_list} FROM "_{_TABLE}_old"'))
    conn.execute(text(f'DROP TABLE "_{_TABLE}_old"'))
    for sql in index_sqls:
        conn.execute(text(sql))


def set_memory_source_check(conn, allow_acknowledged: bool) -> bool:
    """Make the SQLite ck_memory_source CHECK allow (or not) the 'acknowledged' source.

    Returns True when the table was rebuilt. No-op on a fresh/up-to-date table
    or when the table does not exist. On downgrade, 'acknowledged' rows are
    converted to 'excepted' first so the narrower CHECK holds.
    """
    row = conn.execute(text(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=:t"
    ), {"t": _TABLE}).fetchone()
    if not row or not row[0]:
        return False
    sql = row[0]
    has_acknowledged = "'acknowledged'" in sql
    if allow_acknowledged == has_acknowledged:
        return False
    index_sqls = [r[0] for r in conn.execute(text(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=:t AND sql IS NOT NULL"
    ), {"t": _TABLE}).fetchall()]
    if allow_acknowledged:
        new_sql = sql
        for old in _OLD_VARIANTS:
            if old in new_sql:
                new_sql = new_sql.replace(old, _FULL, 1)
                break
        else:
            _log.warning("ck_memory_source definition not recognised; table left unchanged")
            return False
    else:
        conn.execute(text(f"UPDATE {_TABLE} SET source='excepted' WHERE source='acknowledged'"))
        new_sql = sql.replace(_FULL, _BASE, 1)
    _rebuild_memory_table(conn, new_sql, index_sqls)
    return True
