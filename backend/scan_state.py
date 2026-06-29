import threading

# Shared in-memory state for background Wiz scan jobs.
# Keyed by snapshot_id (int) → {status, done, total, findings_count, error}
scan_jobs: dict = {}
scan_jobs_lock = threading.Lock()
