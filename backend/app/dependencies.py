from sqlalchemy.orm import Session
from app.models.base import SessionLocal


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
