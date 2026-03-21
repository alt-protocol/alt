import logging
import os
import threading
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import text
from sqlalchemy.orm import Session

load_dotenv()

from app.dependencies import get_db  # noqa: E402
from app.routers import yields, protocols, portfolio  # noqa: E402
from app.services.kamino_fetcher import fetch_kamino_yields  # noqa: E402
from app.services.drift_fetcher import fetch_drift_yields  # noqa: E402
from app.services.jupiter_fetcher import fetch_jupiter_yields  # noqa: E402
from app.services.kamino_position_fetcher import snapshot_all_wallets_job  # noqa: E402
from app.services.drift_position_fetcher import snapshot_all_wallets_drift_job  # noqa: E402
from app.services.jupiter_position_fetcher import snapshot_all_wallets_job as jupiter_snapshot_job  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()

# Registry — add new fetchers here; the scheduler and refresh script both consume this list
FETCHERS = [
    fetch_kamino_yields,
    fetch_drift_yields,
    fetch_jupiter_yields,
    snapshot_all_wallets_job,
    snapshot_all_wallets_drift_job,
    jupiter_snapshot_job,
]


def _run_initial_fetch():
    """Run all fetchers once on startup, in a background thread."""
    logger.info("Running initial yield fetch in background...")
    for fn in FETCHERS:
        try:
            fn()
        except Exception as exc:
            logger.warning("Initial %s failed: %s", fn.__name__, exc)
    logger.info("Initial yield fetch complete.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run initial fetch in background so the server starts accepting connections immediately
    init_thread = threading.Thread(target=_run_initial_fetch, daemon=True)
    init_thread.start()

    snapshot_jobs = {snapshot_all_wallets_job, snapshot_all_wallets_drift_job, jupiter_snapshot_job}
    # Jupiter's snapshot func shares __name__ with Kamino's — use explicit IDs
    job_ids = {jupiter_snapshot_job: "jupiter_snapshot_all_wallets_job"}
    for fn in FETCHERS:
        scheduler.add_job(
            fn, "interval", minutes=15,
            id=job_ids.get(fn, fn.__name__),
            max_instances=1 if fn in snapshot_jobs else 3,
            coalesce=True,
        )
    scheduler.start()
    logger.info("APScheduler started — yield fetch every 15 minutes")

    yield

    scheduler.shutdown()
    logger.info("APScheduler stopped")


limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Alt API", version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(yields.router, prefix="/api")
app.include_router(protocols.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception:
        return {"status": "degraded", "detail": "database unavailable"}
