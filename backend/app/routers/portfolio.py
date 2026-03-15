from fastapi import APIRouter

router = APIRouter()


@router.get("/portfolio/{wallet_address}")
def get_portfolio(wallet_address: str):
    # TODO: read on-chain positions via Helius DAS API
    return {"wallet": wallet_address, "positions": [], "total_value_usd": 0}
