from fastapi import APIRouter, HTTPException, Depends
from src.models.commander import CommanderRequest, CommanderResponse, ExplainResponse
from src.adapters.detection_adapter import DetectionAdapter, MockDetectionAdapter
from src.services.commander_service import CommanderService

router = APIRouter(prefix="/commander", tags=["commander"])

from functools import lru_cache

def get_detection_adapter() -> DetectionAdapter:
    return MockDetectionAdapter()

@lru_cache()
def get_commander_service() -> CommanderService:
    return CommanderService()

async def resolve_detection(request: CommanderRequest, adapter: DetectionAdapter):
    if request.detection is not None:
        return request.detection
    detection = await adapter.get_detection(request.incident_id)
    if not detection:
        raise HTTPException(status_code=404, detail="Detection not found")
    return detection

@router.post("/analyze", response_model=CommanderResponse)
async def analyze_incident(
    request: CommanderRequest,
    adapter: DetectionAdapter = Depends(get_detection_adapter),
    service: CommanderService = Depends(get_commander_service)
):
    detection = await resolve_detection(request, adapter)
    response = await service.analyze_detection(detection)
    return response

@router.post("/explain", response_model=ExplainResponse)
async def explain_incident(
    request: CommanderRequest,
    adapter: DetectionAdapter = Depends(get_detection_adapter),
    service: CommanderService = Depends(get_commander_service)
):
    detection = await resolve_detection(request, adapter)
    return await service.explain_detection(detection)
