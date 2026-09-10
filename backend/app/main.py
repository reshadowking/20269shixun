"""FastAPI 入口：路由注册 + CORS + 生命周期（v2.2 §9.1 单后端 8000）。"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import init_db
from .logging_config import init_generate_logging
from .otel import init_otel
from .routers import assist, auth, designs, export, generate, health, images, llm_config, sessions, tokens


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_otel()
    init_generate_logging(get_settings().log_dir)
    init_db()
    yield


app = FastAPI(title="AI 原生设计工具后端", version="0.1.0", lifespan=lifespan)

# 开发期全开；生产收紧（二期）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(auth.router)
app.include_router(tokens.router)
app.include_router(generate.router)
app.include_router(assist.router)
app.include_router(llm_config.router)
app.include_router(export.router)
app.include_router(designs.router)
app.include_router(sessions.router)
app.include_router(images.router)


@app.get("/")
def root():
    settings = get_settings()
    return {"app": "ai-native-design-backend", "llm_mode": settings.llm_mode, "docs": "/docs"}
