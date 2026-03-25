from fastapi import APIRouter, Depends, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.models.protocol import Protocol
from app.schemas import ProtocolOut

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


@router.get("/protocols", response_model=dict)
@limiter.limit("60/minute")
def get_protocols(request: Request, db: Session = Depends(get_db)):
    protocols = db.query(Protocol).order_by(Protocol.name).all()
    return {"data": [ProtocolOut.model_validate(p) for p in protocols]}
