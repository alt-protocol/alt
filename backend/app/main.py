from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import yields, protocols, portfolio

app = FastAPI(title="Alt API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(yields.router, prefix="/api")
app.include_router(protocols.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
