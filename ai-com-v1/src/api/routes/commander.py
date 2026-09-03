from fastapi import APIRouter, HTTPException, Depends
from src.models.commander import (
    CommanderRequest,
    CommanderResponse,
    ExplainResponse,
    AskRequest,
    AskResponse,
    KnowledgeRequest,
    KnowledgeContextBody,
    KnowledgeAskResponse,
)
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
    if request.campaign_input is not None:
        return await service.analyze_campaign(request.campaign_input)
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

@router.post("/ask", response_model=AskResponse)
async def ask_commander(
    request: AskRequest,
    service: CommanderService = Depends(get_commander_service),
):
    return await service.ask_snapshot(request.question, request.snapshot)

@router.post("/knowledge", response_model=KnowledgeContextBody)
async def knowledge_enrichment(
    request: KnowledgeRequest,
    service: CommanderService = Depends(get_commander_service),
):
    """
    Knowledge-only RAG enrichment for live Incident Commander.
    Never generates a response plan or executable actions.
    Soft-fails with retrieved=false (HTTP 200).
    """
    query = request.query
    if not query and request.question:
        query = request.question
    return await service.enrich_knowledge(
        detection=request.detection,
        query=query,
        incident_hints=request.incident_hints,
    )


@router.post("/knowledge/ask", response_model=KnowledgeAskResponse)
async def knowledge_ask(
    request: KnowledgeRequest,
    service: CommanderService = Depends(get_commander_service),
):
    """Follow-up Q&A combining live facts + retrieved knowledge. No execution."""
    if not (request.question or "").strip():
        raise HTTPException(status_code=400, detail="question is required")
    return await service.answer_with_knowledge(
        request.question,
        detection=request.detection,
        query=request.query,
        incident_hints=request.incident_hints,
        live_facts=request.live_facts,
    )

@router.post("/posture")
async def city_posture(payload: dict):
    """Deterministic posture belongs on the match server (cityPosture on state:sync)."""
    posture = payload.get("posture")
    if not posture:
        raise HTTPException(
            status_code=400,
            detail="Insufficient observed evidence. Send the room cityPosture snapshot from state:sync.",
        )
    return posture
