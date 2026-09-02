"""代码导出接口（P0-2）：前端生成完整 React 工程文件 → 后端 zipfile 打包下载。

产物：完整可运行 Vite 工程（package.json / src / index.html），解压后 npm install && npm run dev 即可运行。
"""
import io
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..security import get_current_user

router = APIRouter(tags=["export"])


class ExportRequest(BaseModel):
    files: dict[str, str] = Field(min_length=1)
    project_name: str = Field(default="ai-design-export", max_length=64)


@router.post("/api/export")
def export_zip(req: ExportRequest, _user: str = Depends(get_current_user)):
    """把前端生成的工程文件打包为 ZIP（校验路径安全，防 Zip Slip）。"""
    if not req.files:
        raise HTTPException(status_code=422, detail="没有可导出的文件")

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for path, content in req.files.items():
            # 路径安全：只允许相对路径、无 .. 无绝对路径
            normalized = path.replace("\\", "/").lstrip("/")
            if normalized.startswith("..") or ".." in normalized.split("/"):
                raise HTTPException(status_code=422, detail=f"非法文件路径: {path}")
            zf.writestr(normalized, content)
        # 必含关键文件
        for required in ("package.json", "src/App.tsx", "index.html"):
            if required not in {p.replace("\\", "/") for p in req.files}:
                raise HTTPException(status_code=422, detail=f"缺少关键文件: {required}")

    buffer.seek(0)
    filename = f"{req.project_name or 'ai-design-export'}.zip"
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
