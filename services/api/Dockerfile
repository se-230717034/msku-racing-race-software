FROM python:3.12-slim AS runtime

WORKDIR /app
RUN pip install --no-cache-dir uv==0.10.5

COPY pyproject.toml uv.lock ./
COPY packages/engineering ./packages/engineering
COPY services/api ./services/api

RUN uv sync --frozen --package msku-api --no-dev

EXPOSE 8000
CMD ["uv", "run", "--frozen", "--no-dev", "--package", "msku-api", "uvicorn", "msku_api.main:app", "--host", "0.0.0.0", "--port", "8000"]

