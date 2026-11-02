FROM python:3.12-slim

WORKDIR /app

# Runtime dependencies are pinned in requirements.lock (generated from
# pyproject.toml's `postgres` extra), so the image does not resolve new versions
# at build time. The package itself is installed without re-resolving deps.
COPY pyproject.toml requirements.lock ./
COPY src ./src
RUN pip install --no-cache-dir -r requirements.lock \
    && pip install --no-cache-dir --no-deps .

COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

ENV PYTHONPATH=/app/src
ENV SUI_DATABASE_URL=postgresql+asyncpg://sui_sensemaking:sui_sensemaking@db:5432/sui_sensemaking
ENV SUI_LLM_PROVIDER=none

EXPOSE 8000

CMD ["uvicorn", "sui_sensemaking_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
