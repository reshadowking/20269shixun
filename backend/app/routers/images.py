"""图片（资产）路由：上传 / 列表 / 可见性 / 删除 / 读取。

- POST /api/images：multipart，鉴权复用 get_current_user；类型/大小/配额白名单，存到 STORAGE_ROOT
- GET  /api/images：本人资产列表（含可见性、被引用次数、公开链接）
- PATCH /api/images/{id}/visibility：切换 private / workspace / public-link（仅拥有者）
- DELETE /api/images/{id}：删除（T47 引用检查，默认拒绝并列出引用方）
- GET  /api/images/{id}：**读取**（T46b 起要过可见性判定）

读取为什么不能用普通的 Bearer 鉴权：`<img src>` 是浏览器自己发起的请求，**带不了 Authorization 头**。
所以这里做两件事：① 软鉴权（Bearer 头优先，其次 `design_token` cookie，前端登录时写入）；
② public-link 档位用**链接里的 k 做凭证**（HMAC，稳定、不可猜），这样未登录也能读。
"""
import hmac
import json
import uuid
from hashlib import sha256
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..db import get_db
from ..models import AssetFolder, Design, Image, User
from ..security import decode_token, get_current_user
from ..services.workspaces import personal_workspace_of, role_for_design, role_of
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

# T46b：可见性三档
VISIBILITIES = ("private", "workspace", "public-link")
COOKIE_NAME = "design_token"


def _public_key(image_id: int) -> str:
    """public-link 的链接凭证：稳定（同一张图不变）、不可猜（HMAC）。"""
    secret = get_settings().jwt_secret.encode()
    return hmac.new(secret, f"public:{image_id}".encode(), sha256).hexdigest()[:16]


def _public_url(image_id: int) -> str:
    return f"/api/images/{image_id}?k={_public_key(image_id)}"


def _image_ids_in(design_json: str) -> set[int]:
    """设计树里引用的全部图片 id（`props.src` 指向 `/api/images/{id}`，忽略 `?k=` 查询串）。"""
    ids: set[int] = set()
    try:
        tree = json.loads(design_json or "{}")
    except json.JSONDecodeError:
        return ids

    marker = "/api/images/"

    def walk(node: object) -> None:
        if not isinstance(node, dict):
            return
        props = node.get("props")
        if isinstance(props, dict):
            src = props.get("src")
            if isinstance(src, str) and marker in src:
                tail = src.split(marker, 1)[1].split("?", 1)[0].split("/", 1)[0]
                if tail.isdigit():
                    ids.add(int(tail))
        children = node.get("children")
        if isinstance(children, list):
            for child in children:
                walk(child)

    walk(tree)
    return ids


def _reference_index(db: DbSession) -> dict[int, list[Design]]:
    """图片 id → 引用它的设计稿列表（一次全库扫描，列表/读取/删除共用）。"""
    index: dict[int, list[Design]] = {}
    for design in db.execute(select(Design)).scalars().all():
        for image_id in _image_ids_in(design.design_json):
            index.setdefault(image_id, []).append(design)
    return index


def _optional_user_id(db: DbSession, request: Request) -> int | None:
    """软鉴权：Bearer 头优先，其次 `design_token` cookie（`<img src>` 带不了头）。取不到返回 None。"""
    auth = request.headers.get("authorization") or ""
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else request.cookies.get(COOKIE_NAME)
    username = decode_token(token) if token else None
    if username is None:
        return None
    user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    return user.id if user else None


def _can_read_image(db: DbSession, row: Image, me: int | None, k: str | None, refs: list[Design]) -> bool:
    """T46b 读取判定（读不到一律 404，不泄漏存在性）：

    1. `public-link` + 正确 k → 放行（未登录也行）；
    2. 拥有者 → 放行；
    3. `workspace` + 我是该图所属工作区成员 → 放行；
    4. **被我能访问的设计稿引用 → 放行**（这次要解决的问题：协作方能不能加载到我的图）。
       注意第 4 条对 private 同样生效：私有只是"不主动共享"，一旦被共享出去的稿件引用，
       协作者就必须能看到，否则对方画布上是缺图。
    """
    if row.visibility == "public-link" and k and hmac.compare_digest(k, _public_key(row.id)):
        return True
    if me is None:
        return False
    if row.owner_id == me:
        return True
    if row.visibility == "workspace":
        ws = personal_workspace_of(db, row.owner_id)
        workspace_id = row.workspace_id or (ws.id if ws else None)
        if workspace_id is not None and role_of(db, workspace_id, me) is not None:
            return True
    return any(role_for_design(db, design, me) is not None for design in refs)


def _row_payload(db: DbSession, row: Image, refs: list[Design]) -> dict:
    return {
        "id": row.id,
        "filename": row.filename,
        "url": f"/api/images/{row.id}",
        "public_url": _public_url(row.id),
        "visibility": row.visibility or "private",
        "folder_id": row.folder_id,
        "referenced_by": len(refs),
        "size": row.size,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.post("/api/images")
async def upload_image(
    file: UploadFile = File(...),
    folder_id: int | None = Form(default=None),
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

    owner = _owner_id(db, _user)
    # T44：上传前先校验目标文件夹，避免先落盘再报错留下孤儿文件
    if folder_id is not None:
        folder = db.get(AssetFolder, folder_id)
        if folder is None or folder.owner_id != owner:
            raise HTTPException(status_code=404, detail="文件夹不存在或无权访问")

    storage = Path(get_settings().storage_root)
    storage.mkdir(parents=True, exist_ok=True)

    # T38：归属 + 配额（数量/容量）——资产库的前提是"这是谁的"。
    # 2026-09-17 修：配额校验必须**在落盘之前**。原来先 write_bytes 再校验配额，
    # 超限时已经写进磁盘的 2MB 文件就永远没人删（没有对应 DB 行 → 也查不出来），
    # 用户反复重试就是反复泄漏。与上面"上传前先校验文件夹"同一条原则。
    used_count = db.execute(select(func.count()).select_from(Image).where(Image.owner_id == owner)).scalar_one()
    used_bytes = db.execute(
        select(func.coalesce(func.sum(Image.size), 0)).where(Image.owner_id == owner)
    ).scalar_one()
    if used_count >= MAX_ASSETS_PER_USER:
        raise HTTPException(status_code=422, detail=f"资产数量已达上限（{MAX_ASSETS_PER_USER} 个），请先删除不再使用的图片")
    if used_bytes + len(data) > MAX_BYTES_PER_USER:
        raise HTTPException(status_code=422, detail="资产总容量已达上限（20MB），请先删除不再使用的图片")

    name = f"{uuid.uuid4().hex}{ext}"
    (storage / name).write_bytes(data)

    row = Image(
        filename=file.filename or name,
        path=name,
        size=len(data),
        owner_id=owner,
        visibility="private",
        folder_id=folder_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "url": f"/api/images/{row.id}",
        "visibility": row.visibility,
        "folder_id": row.folder_id,
        "public_url": _public_url(row.id),
    }


@router.get("/api/images")
def list_images(
    folder_id: str | None = Query(
        default=None,
        description="T44：不传=全部；`none`=未分组；数字=该文件夹（必须是我自己的）",
    ),
    db: DbSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """T38：当前用户的资产列表（按上传时间倒序）+ 已用容量与配额。

    T46b：附带可见性、被引用次数（删之前先看这个）、公开链接。
    """
    owner = _owner_id(db, _user)
    stmt = select(Image).where(Image.owner_id == owner)
    if folder_id == "none":
        stmt = stmt.where(Image.folder_id.is_(None))
    elif folder_id is not None:
        if not folder_id.isdigit():
            raise HTTPException(status_code=422, detail="folder_id 只接受 `none` 或文件夹 id")
        target = db.get(AssetFolder, int(folder_id))
        if target is None or target.owner_id != owner:
            raise HTTPException(status_code=404, detail="文件夹不存在或无权访问")
        stmt = stmt.where(Image.folder_id == target.id)
    # 2026-09-16 拖拽排序：手工 sort_order 优先，未排过的（全 0）仍按新→旧展示
    rows = db.execute(stmt.order_by(Image.sort_order.asc(), Image.id.desc())).scalars().all()
    index = _reference_index(db)
    # 2026-09-17 修：用量（数量/字节）必须**按账号**统计，不能跟着 `folder_id` 过滤。
    # 配额是账号级的（见 upload_image 的 used_count/used_bytes），列表却被文件夹过滤 ——
    # 原来 used_bytes 取的是"当前范围之和"，于是文件夹里显示"才用了几百字节"，一上传却报
    # "容量已达上限"，页面数字和服务端判定互相打脸。列表过滤、用量不过滤。
    used_count = db.execute(select(func.count()).select_from(Image).where(Image.owner_id == owner)).scalar_one()
    used_bytes = db.execute(
        select(func.coalesce(func.sum(Image.size), 0)).where(Image.owner_id == owner)
    ).scalar_one()
    return {
        "images": [_row_payload(db, r, index.get(r.id, [])) for r in rows],
        "used_bytes": int(used_bytes),
        "used_count": int(used_count),
        "limit_count": MAX_ASSETS_PER_USER,
        "limit_bytes": MAX_BYTES_PER_USER,
    }


class VisibilityRequest(BaseModel):
    visibility: str = Field(min_length=1, max_length=16)


@router.patch("/api/images/{image_id}/visibility")
def set_image_visibility(
    image_id: int,
    req: VisibilityRequest,
    db: DbSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """T46b：切换资产可见性（仅拥有者；他人资产 404 不泄漏存在性）。

    - `private`：仅自己（被共享稿件引用时，协作者仍可读——否则对方缺图）；
    - `workspace`：同一工作区成员都可见；
    - `public-link`：凭 `public_url`（带 k）任何人可读，适合发给外部评审。
    """
    owner = _owner_id(db, _user)
    row = db.get(Image, image_id)
    if row is None or row.owner_id != owner:
        raise HTTPException(status_code=404, detail="资产不存在或无权访问")
    if req.visibility not in VISIBILITIES:
        raise HTTPException(status_code=422, detail=f"visibility 必须是 {'/'.join(VISIBILITIES)} 之一")
    row.visibility = req.visibility
    db.commit()
    db.refresh(row)
    return _row_payload(db, row, _reference_index(db).get(row.id, []))


@router.delete("/api/images/{image_id}")
def delete_image(
    image_id: int,
    force: bool = False,
    db: DbSession = Depends(get_db),
    _user: str = Depends(get_current_user),
):
    """T38/T47：删除自己的资产（同时删文件）；他人资产返回 404（不泄漏存在性）。

    T47 **引用检查**：若仍有设计稿引用这张图（含协作者的设计稿），默认拒绝并列出引用方，
    避免"我删了自己的图，协作方那边变缺图"。确实要删时用 `?force=true`。
    """
    owner = _owner_id(db, _user)
    row = db.get(Image, image_id)
    if row is None or row.owner_id != owner:
        raise HTTPException(status_code=404, detail="资产不存在或无权访问")
    # T47：按"设计树里 props.src 是否指向本图"精确判定引用（解析比对，不用 SQL LIKE：
    # `%/api/images/1%` 会误匹配 `/api/images/12`）。T46b 起索引统一由 _reference_index 提供，
    # 顺带修掉"src 带 ?k= 时匹配不上"的漏判。
    refs = _reference_index(db).get(image_id, [])
    if refs and not force:
        names = "、".join(str(d.name) for d in refs[:3])
        more = "…" if len(refs) > 3 else ""
        raise HTTPException(
            status_code=409,
            detail=f"该图片仍被 {len(refs)} 个设计稿引用（{names}{more}），删除后这些稿会缺图。确认删除请加 ?force=true。",
        )
    path = Path(get_settings().storage_root) / row.path
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass  # 文件缺失也算删除成功（记录优先清理）
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/api/images/{image_id}")
def get_image(image_id: int, request: Request, k: str | None = None, db: DbSession = Depends(get_db)):
    """返回图片文件。**T46b 起不再无条件公开**：按可见性判定，读不到一律 404。"""
    row = db.get(Image, image_id)
    if row is None:
        raise HTTPException(status_code=404, detail="图片不存在或无权访问")
    me = _optional_user_id(db, request)
    if not _can_read_image(db, row, me, k, _reference_index(db).get(row.id, [])):
        raise HTTPException(status_code=404, detail="图片不存在或无权访问")
    path = Path(get_settings().storage_root) / row.path
    if not path.exists():
        raise HTTPException(status_code=404, detail="图片文件缺失")
    return FileResponse(path)
