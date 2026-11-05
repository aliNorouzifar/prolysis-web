# Prolysis backend — FastAPI API + Procrastinate worker (same image, different command).
# Pure Python, no JVM; needs Graphviz for model rendering.
FROM python:3.11-slim

# PYTHONPATH: the `procrastinate` console script imports `app.jobs` — entry-point
# scripts do not put the CWD on sys.path, so make /app importable explicitly.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app

RUN apt-get update \
    && apt-get install -y --no-install-recommends graphviz \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# `prolysis` comes from PyPI (>=0.3.0). Until that release is published, build a wheel
# from the prolysis checkout and drop it into backend/vendor/ — it is installed first:
#   (in the prolysis repo)  python -m build --wheel
#   cp dist/prolysis-0.3.0-py3-none-any.whl <this-repo>/backend/vendor/
COPY vendor ./vendor
RUN if ls vendor/*.whl >/dev/null 2>&1; then pip install vendor/*.whl; fi

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

EXPOSE 8000

# Default command runs the API. The worker service overrides this in docker-compose.yml.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
