FROM python:3.13-slim

RUN groupadd --system appuser && useradd --system --gid appuser appuser

WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app/ ./app/
COPY backend/etc/models.json backend/etc/runtime_pricing.json ./etc/

# Agent source for build_agent_artifact (deployment.py resolves via parents[3] -> /)
COPY agents/strands_agent/src/ /agents/strands_agent/src/
COPY agents/strands_agent/requirements.txt /agents/strands_agent/requirements.txt

EXPOSE 8000

USER appuser

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
