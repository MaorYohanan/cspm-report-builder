import threading

# Shared in-memory state for background Wiz scan jobs.
# Keyed by snapshot_id (int) → {status, done, total, findings_count, error}
#
# SINGLE-WORKER REQUIREMENT: this dict lives in the process memory of one gunicorn
# worker. Multiple workers each have their own copy — scans started by worker A are
# invisible to worker B. gunicorn.conf.py must keep workers=1 (threads=N is fine).
# Long-term fix: persist scan state to the DB or a shared store (Redis / Cloud Tasks).
scan_jobs: dict = {}
scan_jobs_lock = threading.Lock()
