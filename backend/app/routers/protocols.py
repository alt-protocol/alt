from fastapi import APIRouter

router = APIRouter()


@router.get("/protocols")
def get_protocols():
    # TODO: query protocols from DB
    return {"data": []}
