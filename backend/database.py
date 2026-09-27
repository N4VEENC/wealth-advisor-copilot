"""SQLAlchemy engine/session setup for the app's SQLite database.

The live database file lives OUTSIDE this project directory, at
%LOCALAPPDATA%\\WealthAdvisorCopilot\\wealth_advisor.db (falls back to
~/.wealth_advisor_copilot/wealth_advisor.db on non-Windows). On a fresh clone,
backend/data/wealth_advisor_seed.db is copied here once to provide the same
starting data without running SQLite inside the synced project directory.
An existing local database is never overwritten.
Reason: this project's directory lives inside OneDrive, and OneDrive's sync
agent holds an OS-level lock on a file while uploading/rescanning it after
every write, which collides with SQLite's own locking. Reproduced directly
(confirmed via a plain `sqlite3.connect(...)` with zero app code involved,
and via a raw Windows-API exclusive-open attempt with zero processes of this
app running at all — the file was still locked, held by OneDrive.Sync.Service)
before this file was moved out of backend/data/. Moving the live,
frequently-written file out of any synced folder is the actual fix; a
busy-timeout alone was measured to still fail after 30+ continuous seconds
of lock contention. To inspect the database with DB Browser for SQLite,
point it at DB_PATH below (run `python -c "from database import DB_PATH;
print(DB_PATH)"` from backend/ to print the exact path), not at the old
backend/data/ location — see backend/data/WHERE_IS_THE_DATABASE.md.

Every service module that used to read/write a JSON file directly
(client_store.py, report_store.py, audit_log.py, chat_service.py's history,
routers/strategies.py) now goes through session_scope() here instead — see
models.py for the table definitions those modules query.
"""
from __future__ import annotations

import os
import shutil
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

_APP_DATA_DIR = Path(os.environ["LOCALAPPDATA"]) / "WealthAdvisorCopilot" if os.name == "nt" else Path.home() / ".wealth_advisor_copilot"
_APP_DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = _APP_DATA_DIR / "wealth_advisor.db"
_SEED_DB_PATH = Path(__file__).resolve().parent / "data" / "wealth_advisor_seed.db"
if not DB_PATH.exists() and _SEED_DB_PATH.is_file():
    shutil.copy2(_SEED_DB_PATH, DB_PATH)

# `timeout` is sqlite3's own busy-timeout (seconds): if a connection finds the
# database locked by another connection's write, it retries for this long
# before raising "database is locked" instead of failing instantly. This
# absorbs ordinary contention (FastAPI runs sync endpoint functions in a
# thread pool, so two real concurrent requests can genuinely open two
# simultaneous connections) now that the OneDrive lock conflict described
# above no longer applies. WAL mode is deliberately NOT used even at this
# new location: it wasn't re-tested after the move and rollback-journal +
# this busy-timeout is already sufficient for this app's traffic (a single
# advisor's browser).
engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 15},
)


@event.listens_for(engine, "connect")
def _enable_foreign_keys(dbapi_connection, _connection_record) -> None:
    # SQLite ignores declared ForeignKeys (including ON DELETE CASCADE)
    # unless this pragma is set on every connection — without it, deleting a
    # Client would silently leave orphaned holdings_lots/chat rows behind.
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


@contextmanager
def session_scope() -> Iterator[Session]:
    """One transaction per call: commits on success, rolls back on any
    exception, always closes. Every read OR write in the services below goes
    through this rather than managing sessions ad hoc."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
