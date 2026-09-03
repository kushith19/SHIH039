from contextlib import asynccontextmanager
import asyncio
import logging
import os

from fastapi import FastAPI
from src.api.routes import health, commander
from src.config.settings import settings

logger = logging.getLogger(__name__)


def _should_warm_rag() -> bool:
    skip = os.environ.get("AI_COMMANDER_SKIP_RAG_WARMUP", "").strip().lower()
    return skip not in ("1", "true", "yes")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Warm SentenceTransformer / retriever before serving traffic so GET /health
    only succeeds after startup work completes (avoids first-request hangs).
    Soft-fails if Qdrant/model unavailable — knowledge endpoints still soft-fail.
    """
    if _should_warm_rag():
        try:
            svc = commander.get_commander_service()
            await asyncio.to_thread(svc._ensure_retriever)
            logger.info("RAG retriever warmed before serving")
        except Exception as e:
            logger.warning("RAG warm-up failed (knowledge will soft-fail until ready): %s", e)
    yield


app = FastAPI(
    title=settings.app_name,
    description="AI Commander V1 Microservice API",
    version="1.0.0",
    lifespan=lifespan,
)

# Include routers
app.include_router(health.router)
app.include_router(commander.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host=settings.host, port=settings.port, reload=False)
