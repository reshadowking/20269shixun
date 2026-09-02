"""健康检查（v2.2 §9.2）。"""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

router = APIRouter(tags=["health"])


@router.get("/api/health")
def health(db: Session = Depends(get_db)):
    db_ok = True
    db_error = ""
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:  # noqa: BLE001 - 健康检查需要兜底所有异常
        db_ok = False
        db_error = str(e)[:200]
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "ok" if db_ok else "error",
        "database_error": db_error,
    }
