import logging
import os
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

load_dotenv()

from app.dependencies import get_db  # noqa: E402
from app.routers import yields, protocols, portfolio  # noqa: E402
from app.services.yield_fetcher import fetch_and_store_yields  # noqa: E402
from app.services.kamino_fetcher import fetch_kamino_yields  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

scheduler = BackgroundScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        logger.info("Running initial yield fetch on startup...")
        fetch_kamino_yields()
        fetch_and_store_yields()
    except Exception as exc:
        logger.warning("Initial yield fetch failed (DB may not be ready): %s", exc)

    scheduler.add_job(fetch_kamino_yields, "interval", minutes=15, id="kamino_fetch")
    scheduler.add_job(fetch_and_store_yields, "interval", minutes=15, id="defillama_fetch")
    scheduler.start()
    logger.info("APScheduler started — yield fetch every 15 minutes")

    yield

    scheduler.shutdown()
    logger.info("APScheduler stopped")


app = FastAPI(title="Alt API", version="0.1.0", lifespan=lifespan)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
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
