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
MAX_DEPTH = 3  # 最多三层（顶层=1）；再深在演示规模下只会让"移动/计数/权限"变难说清


def _my_folder(db: DbSession, folder_id: int | None, owner: int) -> AssetFolder:
    """取自己的文件夹（不存在/不是我的 → 404）。"""
    folder = db.get(AssetFolder, folder_id) if folder_id is not None else None
    if folder is None or folder.owner_id != owner:
        raise HTTPException(status_code=404, detail="文件夹不存在或无权访问")
    return folder


def _all_my_folders(db: DbSession, owner: int) -> list[AssetFolder]:
    return db.execute(select(AssetFolder).where(AssetFolder.owner_id == owner)).scalars().all()


def _depth_of(folders: dict[int, AssetFolder], folder_id: int | None) -> int:
    """自底向上数层级（顶层 = 1）。数据异常（环）时截断，不让请求挂死。"""
    depth = 0
    cur = folder_id
    seen: set[int] = set()
    while cur is not None and cur not in seen:
        seen.add(cur)
        depth += 1
        node = folders.get(cur)
        cur = node.parent_id if node else None
    return depth


def _require_valid_parent(db: DbSession, owner: int, parent_id: int | None, moving_id: int | None = None) -> None:
    """父级合法性：必须是我的、不能是自己或自己的后代（防环）、层级不超上限。"""
    folders = {f.id: f for f in _all_my_folders(db, owner)}
    if parent_id is None:
        return
    if parent_id not in folders:
        raise HTTPException(status_code=404, detail="目标文件夹不存在或无权访问")
    if moving_id is not None:
        if parent_id == moving_id:
            raise HTTPException(status_code=422, detail="不能把文件夹移到它自己里面")
        cur: int | None = parent_id
        seen: set[int] = set()
        while cur is not None and cur not in seen:
            if cur == moving_id:
                raise HTTPException(status_code=422, detail="不能把文件夹移到它自己的子目录里")
            seen.add(cur)
            node = folders.get(cur)
            cur = node.parent_id if node else None
    if _depth_of(folders, parent_id) + (0 if moving_id is None else _subtree_height(folders, moving_id)) >= MAX_DEPTH:
        raise HTTPException(status_code=422, detail=f"目录层级最多 {MAX_DEPTH} 层")


def _subtree_height(folders: dict[int, AssetFolder], root_id: int) -> int:
    """以 root_id 为根的子树高度（叶子=1）——移动时用来判断"搬过去会不会超深"。"""
    children: dict[int, list[int]] = {}
    for f in folders.values():
        if f.parent_id is not None:
            children.setdefault(f.parent_id, []).append(f.id)
    if root_id not in folders:
        return 1
    depth = 0
    frontier = [root_id]
    while frontier:
        depth += 1
        nxt: list[int] = []
        for node in frontier:
            nxt.extend(children.get(node, []))
        frontier = nxt
    return max(1, depth)


@router.get("/api/asset-folders")
def list_folders(db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """我的文件夹 + 每个文件夹的资产数 + 未分组数量。"""
    owner = _owner_id(db, _user)
    folders = (
        db.execute(
            select(AssetFolder)
            .where(AssetFolder.owner_id == owner)
            .order_by(AssetFolder.sort_order.asc(), AssetFolder.id.asc())
        )
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
                # 多层目录：前端据此建树（顶层 = null）
                "parent_id": f.parent_id,
                "count": int(counts.get(f.id, 0)),
                "created_at": f.created_at.isoformat() if f.created_at else None,
            }
            for f in folders
        ],
        "ungrouped": int(ungrouped),
        "limit_folders": MAX_FOLDERS,
    }


class FolderRequest(BaseModel):
    """新建/改名共用：新建时可指定 `parent_id`（多层目录），改名时该字段忽略。"""

    name: str = Field(min_length=1, max_length=MAX_NAME)
    parent_id: int | None = None


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
    _require_valid_parent(db, owner, req.parent_id)
    folder = AssetFolder(owner_id=owner, name=name, parent_id=req.parent_id)
    db.add(folder)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"已存在同名文件夹「{name}」") from None
    db.refresh(folder)
    return {"id": folder.id, "name": folder.name, "parent_id": folder.parent_id, "count": 0}


class OrderRequest(BaseModel):
    """拖拽排序：按数组顺序写入 sort_order（0..n-1）。"""

    ids: list[int] = Field(min_length=1, max_length=200)


# 注意：这条必须声明在 `/{folder_id}` 之前——FastAPI 按声明顺序匹配，
# 否则 "/api/asset-folders/order" 会先撞上 `folder_id: int` 解析失败（返回 422）。
@router.patch("/api/asset-folders/order")
def reorder_folders(req: OrderRequest, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """文件夹手工排序（仅自己的文件夹；传进来的 id 必须全部属于我，否则 404）。"""
    owner = _owner_id(db, _user)
    mine = {f.id for f in db.execute(select(AssetFolder).where(AssetFolder.owner_id == owner)).scalars().all()}
    if any(i not in mine for i in req.ids):
        raise HTTPException(status_code=404, detail="文件夹不存在或无权访问")
    for index, folder_id in enumerate(req.ids):
        folder = db.get(AssetFolder, folder_id)
        if folder is not None:
            folder.sort_order = index
    db.commit()
    return {"ok": True, "count": len(req.ids)}


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


class MoveFolderRequest(BaseModel):
    """parent_id 为 null = 移到顶层。"""

    parent_id: int | None = None


@router.patch("/api/asset-folders/{folder_id}/parent")
def move_folder(
    folder_id: int,
    req: MoveFolderRequest,
    db: DbSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """改变文件夹的父级（多层目录）。

    三层校验，缺一不可：目标父级必须是**我的**（否则 404，不泄漏存在性）；
    不能是自己或自己的后代（否则 422，防环）；整棵子树搬过去后不能超过 `MAX_DEPTH`。
    """
    owner = _owner_id(db, _user)
    folder = _my_folder(db, folder_id, owner)
    _require_valid_parent(db, owner, req.parent_id, moving_id=folder.id)
    folder.parent_id = req.parent_id
    db.commit()
    return {"id": folder.id, "parent_id": folder.parent_id}


@router.delete("/api/asset-folders/{folder_id}")
def delete_folder(folder_id: int, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)):
    """删除文件夹：**内容上提一层**（不删任何东西）。

    - 里面的资产 → 该文件夹的父级（顶层文件夹的父级就是"未分组"，与旧行为一致）；
    - 子文件夹 → 同样上提到父级（多层目录下的"删中间层不断链"）。
    """
    owner = _owner_id(db, _user)
    folder = _my_folder(db, folder_id, owner)
    parent_id = folder.parent_id
    moved = (
        db.execute(select(Image).where(Image.owner_id == owner, Image.folder_id == folder.id)).scalars().all()
    )
    for image in moved:
        image.folder_id = parent_id
    children = db.execute(
        select(AssetFolder).where(AssetFolder.owner_id == owner, AssetFolder.parent_id == folder.id)
    ).scalars().all()
    for child in children:
        child.parent_id = parent_id
    db.delete(folder)
    db.commit()
    return {"ok": True, "moved_to_ungrouped": len(moved), "children_lifted": len(children)}


class MoveAssetRequest(BaseModel):
    """folder_id 为 null = 移出到"未分组"。"""

    folder_id: int | None = None


class AssetOrderRequest(OrderRequest):
    """资产排序：必须指定**作用域**（某个文件夹或未分组），避免把别的文件夹的顺序搅乱。"""

    folder_id: int | None = None


@router.patch("/api/images/order")
def reorder_assets(
    req: AssetOrderRequest, db: DbSession = Depends(get_db), _user: str = Depends(get_current_user)
):
    """文件夹内（或未分组）资产手工排序。

    校验两条：① 每个 id 都是我的资产；② 每个 id 当前就在该作用域内。
    否则拒绝——拖拽排序绝不能改到别的文件夹里去。
    """
    owner = _owner_id(db, _user)
    if req.folder_id is not None:
        target = db.get(AssetFolder, req.folder_id)
        if target is None or target.owner_id != owner:
            raise HTTPException(status_code=404, detail="文件夹不存在或无权访问")
    rows = db.execute(select(Image).where(Image.id.in_(req.ids))).scalars().all()
    if len(rows) != len(set(req.ids)):
        raise HTTPException(status_code=404, detail="资产不存在或无权访问")
    # 两种拒绝口径分开：不是我的资产 → 404（不泄漏存在性）；是我的但不在该作用域 → 409（如实说明）
    if any(row.owner_id != owner for row in rows):
        raise HTTPException(status_code=404, detail="资产不存在或无权访问")
    if any(row.folder_id != req.folder_id for row in rows):
        raise HTTPException(status_code=409, detail="资产不属于该文件夹，排序未生效")
    by_id = {row.id: row for row in rows}
    for index, image_id in enumerate(req.ids):
        by_id[image_id].sort_order = index
    db.commit()
    return {"ok": True, "count": len(req.ids)}


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
