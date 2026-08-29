from fastapi import APIRouter
from pydantic import BaseModel
from src.config.settings import settings

router = APIRouter()

class HealthResponse(BaseModel):
    service: str
    status: str
    env: str

@router.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        service=settings.app_name,
        status="healthy",
        env=settings.app_env
    )
