"""T44：资产文件夹（一层目录，组织「我的资产」）。

设计取舍：
- **一层**，不做嵌套（演示规模够用；嵌套会把权限/移动/计数复杂度放大数倍）；
- **删除文件夹不删资产**：里面的资产回落"未分组"（folder_id=NULL）——删目录顺手删素材是不可接受的；
- 所有操作只作用于**自己的**资产/文件夹（他人的一律 404，不泄漏存在性）。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DbSession

from ..db import get_db
from ..models import AssetFolder, Image
from ..security import get_current_user
from .sessions import _owner_id

router = APIRouter(tags=["asset-folders"])

MAX_FOLDERS = 30
MAX_NAME = 32


def _my_folder(db: DbSession, folder_id: int | None, owner: int) -> AssetFolder:
    """取自己的文件夹（不存在/不是我的 → 404）。"""
    folder = db.get(AssetFolder, folder_id) if folder_id is not None else None
    if folder is None or folder.owner_id != owner:
        raise HTTPException(status_code=404, detail="文件夹不存在或无权访问")
    return folder


@router.get("/api/asset-folders")
def list_folders(db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """我的文件夹 + 每个文件夹的资产数 + 未分组数量。"""
    owner = _owner_id(db, _user)
    folders = (
        db.execute(select(AssetFolder).where(AssetFolder.owner_id == owner).order_by(AssetFolder.id.asc()))
        .scalars()
        .all()
    )
    counts = dict(
        db.execute(
            select(Image.folder_id, func.count())
            .where(Image.owner_id == owner, Image.folder_id.is_not(None))
            .group_by(Image.folder_id)
        ).all()
    )
    ungrouped = db.execute(
        select(func.count()).select_from(Image).where(Image.owner_id == owner, Image.folder_id.is_(None))
    ).scalar_one()
    return {
        "folders": [
            {
                "id": f.id,
                "name": f.name,
                "count": int(counts.get(f.id, 0)),
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in folders
        ],
        "ungrouped": int(ungrouped),
        "limit_folders": MAX_FOLDERS,
    }


class FolderRequest(BaseModel):
    name: str = Field(min_length=1, max_length=MAX_NAME)


@router.post("/api/asset-folders")
def create_folder(req: FolderRequest, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """新建文件夹（同名 409，避免出现两个"图标"分不清是哪个）。"""
    owner = _owner_id(db, _user)
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="文件夹名不能为空")
    used = db.execute(select(func.count()).select_from(AssetFolder).where(AssetFolder.owner_id == owner)).scalar_one()
    if used >= MAX_FOLDERS:
        raise HTTPException(status_code=422, detail=f"文件夹数量已达上限（{MAX_FOLDERS} 个）")
    folder = AssetFolder(owner_id=owner, name=name)
    db.add(folder)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"已存在同名文件夹「{name}」") from None
    db.refresh(folder)
    return {"id": folder.id, "name": folder.name, "count": 0}


@router.patch("/api/asset-folders/{folder_id}")
def rename_folder(
    folder_id: int, req: FolderRequest, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)
):
    owner = _owner_id(db, _user)
    folder = _my_folder(db, folder_id, owner)
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="文件夹名不能为空")
    folder.name = name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"已存在同名文件夹「{name}」") from None
    return {"id": folder.id, "name": folder.name}


@router.delete("/api/asset-folders/{folder_id}")
def delete_folder(folder_id: int, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """删除文件夹：里面的资产回落"未分组"（**不删资产**）。"""
    owner = _owner_id(db, _user)
    folder = _my_folder(db, folder_id, owner)
    moved = (
        db.execute(select(Image).where(Image.owner_id == owner, Image.folder_id == folder.id)).scalars().all()
    )
    for image in moved:
        image.folder_id = None
    db.delete(folder)
    db.commit()
    return {"ok": True, "moved_to_ungrouped": len(moved)}


class MoveAssetRequest(BaseModel):
    """folder_id 为 null = 移出到"未分组"。"""

    folder_id: int | None = None


@router.patch("/api/images/{image_id}/folder")
def move_asset(
    image_id: int,
    req: MoveAssetRequest,
    db: DbSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """把资产移到某个文件夹（仅拥有者；目标文件夹也必须是自己的）。"""
    owner = _owner_id(db, _user)
    image = db.get(Image, image_id)
    if image is None or image.owner_id != owner:
        raise HTTPException(status_code=404, detail="资产不存在或无权访问")
    if req.folder_id is not None:
        _my_folder(db, req.folder_id, owner)
    image.folder_id = req.folder_id
    db.commit()
    db.refresh(image)
    return {"id": image.id, "folder_id": image.folder_id}
