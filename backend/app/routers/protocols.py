from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.dependencies import get_db
from app.models.protocol import Protocol
from app.schemas import ProtocolOut

router = APIRouter()


@router.get("/protocols", response_model=dict)
def get_protocols(db: Session = Depends(get_db)):
    protocols = db.query(Protocol).order_by(Protocol.name).all()
    return {"data": [ProtocolOut.model_validate(p) for p in protocols]}
