# 后端镜像（v2.2 §13：FastAPI 单后端）
FROM python:3.13-slim

WORKDIR /app

# 依赖层（利用缓存）
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 应用代码 + 自动生成的令牌常量（app/design/tokens.py 已随源码生成）
COPY backend/app ./app
# 设计 Schema 唯一源（validator 按 backend/app/design/validator.py 向上 4 级解析到 /shared）
COPY shared /shared

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
