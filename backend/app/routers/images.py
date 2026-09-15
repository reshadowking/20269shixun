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

from ..config import get_settings
from ..db import get_db
from ..models import Image
from ..security import get_current_user

router = APIRouter(tags=["images"])

# 类型白名单（svg 含脚本执行面，不收）；大小上限 2MB
ALLOWED_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_IMAGE_BYTES = 2 * 1024 * 1024


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

    row = Image(filename=file.filename or name, path=name, size=len(data))
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "url": f"/api/images/{row.id}"}


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
