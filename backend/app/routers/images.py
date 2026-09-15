"""图片上传路由（D2：画布 image 组件本地上传）。

- POST /api/images：multipart（python-multipart），鉴权复用 get_current_user；
  类型/大小白名单，存储到 STORAGE_ROOT（backend/designs/images，git 排除/compose volume）
- GET /api/images/{id}：返回图片文件（id 为自增主键，演示环境放宽免鉴权；
  文件名为 uuid 难枚举，不暴露用户目录结构）
"""
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..db import get_db
from ..models import Image
from ..security import get_current_user
from .sessions import _owner_id  # T38：复用既有的"用户名 → owner_id"解析（单一实现）

router = APIRouter(tags=["images"])

# 类型白名单（svg 含脚本执行面，不收）；大小上限 2MB
ALLOWED_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_IMAGE_BYTES = 2 * 1024 * 1024
# T38：每用户配额（演示规模；超限给可读提示，而不是无限堆积）
MAX_ASSETS_PER_USER = 50
MAX_BYTES_PER_USER = 20 * 1024 * 1024


@router.post("/api/images")
async def upload_image(
    file: UploadFile = File(...),
    _user: str = Depends(get_current_user),
    db=Depends(get_db),
):
    """上传图片，返回可访问 URL（写入 props.src 用；相对路径通过导出 safeSrc 白名单）。"""
    ext = ALLOWED_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(status_code=422, detail=f"不支持的图片类型：{file.content_type or '未知'}（仅 png/jpeg/webp/gif）")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="空文件")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=422, detail="图片超过 2MB 上限")

    storage = Path(get_settings().storage_root)
    storage.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    (storage / name).write_bytes(data)

    # T38：归属 + 配额（数量/容量）——资产库的前提是"这是谁的"
    owner = _owner_id(db, _user)
    used_count = db.execute(select(func.count()).select_from(Image).where(Image.owner_id == owner)).scalar_one()
    used_bytes = db.execute(
        select(func.coalesce(func.sum(Image.size), 0)).where(Image.owner_id == owner)
    ).scalar_one()
    if used_count >= MAX_ASSETS_PER_USER:
        raise HTTPException(status_code=422, detail=f"资产数量已达上限（{MAX_ASSETS_PER_USER} 个），请先删除不再使用的图片")
    if used_bytes + len(data) > MAX_BYTES_PER_USER:
        raise HTTPException(status_code=422, detail="资产总容量已达上限（20MB），请先删除不再使用的图片")

    row = Image(filename=file.filename or name, path=name, size=len(data), owner_id=owner)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "url": f"/api/images/{row.id}"}


@router.get("/api/images")
def list_images(db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """T38：当前用户的资产列表（按上传时间倒序）+ 已用容量与配额。"""
    owner = _owner_id(db, _user)
    rows = db.execute(select(Image).where(Image.owner_id == owner).order_by(Image.id.desc())).scalars().all()
    return {
        "images": [
            {
                "id": r.id,
                "filename": r.filename,
                "url": f"/api/images/{r.id}",
                "size": r.size,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
        "used_bytes": sum(r.size for r in rows),
        "limit_count": MAX_ASSETS_PER_USER,
        "limit_bytes": MAX_BYTES_PER_USER,
    }


@router.delete("/api/images/{image_id}")
def delete_image(image_id: int, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """T38：删除自己的资产（同时删文件）；他人资产返回 404（不泄漏存在性）。"""
    owner = _owner_id(db, _user)
    row = db.get(Image, image_id)
    if row is None or row.owner_id != owner:
        raise HTTPException(status_code=404, detail="资产不存在或无权访问")
    path = Path(get_settings().storage_root) / row.path
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass  # 文件缺失也算删除成功（记录优先清理）
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/api/images/{image_id}")
def get_image(image_id: int, db=Depends(get_db)):
    """返回图片文件（FileResponse 按扩展名推断 content-type）。"""
    row = db.get(Image, image_id)
    if row is None:
        raise HTTPException(status_code=404, detail="图片不存在")
    path = Path(get_settings().storage_root) / row.path
    if not path.exists():
        raise HTTPException(status_code=404, detail="图片文件缺失")
    return FileResponse(path)
