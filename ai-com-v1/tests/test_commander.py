import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from src.main import app
from src.models.detection import DetectionInput, DetectionType, Severity
from src.api.routes.commander import get_commander_service
from src.rag.models.document import RetrievalResult
from pydantic import ValidationError

client = TestClient(app)

def fake_retriever():
    from unittest.mock import MagicMock
    retriever = MagicMock()
    retriever.retrieve.return_value = RetrievalResult(
        results=[],
        embedding_latency_ms=0,
        search_latency_ms=0,
        total_latency_ms=0,
    )
    return retriever

def test_valid_detection_input_validation():
    # 1. Valid DetectionInput validation
    data = {
        "incidentId": "INC-TEST",
        "timestamp": "2026-08-26T00:00:00Z",
        "detectionType": "behavioral_anomaly",
        "severity": "high",
        "confidence": 0.8,
        "riskScore": 0.75,
        "affectedEndpoints": ["node1"],
        "evidence": [],
        "metadata": {}
    }
    detection = DetectionInput(**data)
    assert detection.incident_id == "INC-TEST"
    assert detection.detection_type == DetectionType.behavioral_anomaly
    assert detection.severity == Severity.high

def test_invalid_detection_input_rejection():
    # 2. Invalid DetectionInput rejection
    data = {
        "incidentId": "INC-TEST",
        "timestamp": "invalid-time",
        "detectionType": "fake_type",
        "severity": "high",
        "confidence": 1.5,
        "riskScore": 0.75
    }
    with pytest.raises(ValidationError):
        DetectionInput(**data)

@pytest.mark.asyncio
async def test_mock_detection_adapter_returns_deterministic_data():
    # 3. MockDetectionAdapter returns deterministic data for all scenarios
    from src.adapters.detection_adapter import MockDetectionAdapter
    adapter = MockDetectionAdapter()
    
    # Test all known incidents
    incident_ids = ["INC-001", "INC-002", "INC-003", "INC-004", "INC-005", "INC-006"]
    for i_id in incident_ids:
        detection = await adapter.get_detection(i_id)
        assert detection is not None
        assert detection.incident_id == i_id
        # Validation is implicit since get_detection returns a parsed DetectionInput
    
    # Check specific INC-001 properties to remain compatible
    det_001 = await adapter.get_detection("INC-001")
    assert det_001.confidence == 0.91
    assert "hospital-emr" in det_001.affected_endpoints
    assert len(det_001.evidence) > 0
    assert any(
        isinstance(ev, dict)
        and (
            ev.get("deviationPct") is not None
            or (ev.get("previous") is not None and ev.get("current") is not None)
        )
        for ev in det_001.evidence
    )

    # Check unknown ID
    unknown = await adapter.get_detection("UNKNOWN-ID")
    assert unknown is None

@pytest.mark.asyncio
@patch("src.agent.graph.get_llm_provider")
async def test_commander_service_converts_detection(mock_get_provider):
    # Mock the LLM to return deterministic Phase 2 style output
    import json
    from unittest.mock import MagicMock
    mock_llm = MagicMock()
    plan_response = MagicMock()
    plan_response.content = json.dumps({"queries": [{"query": "test query", "rationale": "test", "priority": "high"}]})
    
    sufficiency_response = MagicMock()
    sufficiency_response.content = json.dumps({"sufficient": True, "confidence": 0.9, "missing_domains": [], "rationale": "test"})
    
    assessment_response = MagicMock()
    assessment_response.content = json.dumps({
        "incidentId": "INC-001",
        "assessment": {"severity": "high", "summary": "Mock", "confidence": 0.91},
        "impact": {"affectedEndpoints": ["hospital-emr"], "affectedSectors": [], "criticalInfrastructure": ["hospital-emr"]},
        "evidence": [],
        "recommendations": []
    })
    
    mock_llm.invoke.return_value = assessment_response
    mock_llm.bind.return_value = mock_llm
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_provider.return_value = mock_provider

    # 4. CommanderService converts DetectionInput into CommanderResponse
    from src.adapters.detection_adapter import MockDetectionAdapter
    from src.services.commander_service import CommanderService
    adapter = MockDetectionAdapter()
    service = CommanderService(retriever=fake_retriever())
    
    detection = await adapter.get_detection("INC-001")
    response = await service.analyze_detection(detection)
    
    assert response.incident_id == "INC-001"
    assert response.assessment.severity == "high"
    assert "hospital-emr" in response.impact.critical_infrastructure

@patch("src.agent.graph.get_llm_provider")
def test_post_commander_analyze_success(mock_get_provider):
    # Mock the LLM
    import json
    from unittest.mock import MagicMock
    mock_llm = MagicMock()
    plan_response = MagicMock()
    plan_response.content = json.dumps({"queries": [{"query": "test query", "rationale": "test", "priority": "high"}]})
    
    sufficiency_response = MagicMock()
    sufficiency_response.content = json.dumps({"sufficient": True, "confidence": 0.9, "missing_domains": [], "rationale": "test"})
    
    assessment_response = MagicMock()
    assessment_response.content = json.dumps({
        "incidentId": "INC-001",
        "assessment": {"severity": "high", "summary": "Mock", "confidence": 0.91},
        "impact": {"affectedEndpoints": ["telecom-network-gateway"], "affectedSectors": [], "criticalInfrastructure": []},
        "evidence": [],
        "recommendations": []
    })
    
    mock_llm.invoke.return_value = assessment_response
    mock_llm.bind.return_value = mock_llm
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_provider.return_value = mock_provider

    # 5. POST /commander/analyze returns HTTP 200
    # 6. Response contains the expected incident ID.
    # 7. Response contains assessment, impact, evidence, and recommendations.
    from src.services.commander_service import CommanderService
    payload = {"incidentId": "INC-001"}
    app.dependency_overrides[get_commander_service] = lambda: CommanderService(retriever=fake_retriever())
    try:
        response = client.post("/commander/analyze", json=payload)
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 200
    
    data = response.json()
    assert data["incidentId"] == "INC-001"
    assert "assessment" in data
    assert "impact" in data
    assert "evidence" in data
    assert "recommendations" in data
    
    assert data["assessment"]["severity"] == "high"
    assert "telecom-network-gateway" in data["impact"]["affectedEndpoints"]

def test_post_commander_analyze_not_found():
    # 8. Malformed requests / unknown incident rejected appropriately
    payload = {"incidentId": "UNKNOWN-001"}
    response = client.post("/commander/analyze", json=payload)
    assert response.status_code == 404
    assert response.json()["detail"] == "Detection not found"

def test_post_commander_analyze_malformed():
    payload = {"wrongField": "INC-001"}
    response = client.post("/commander/analyze", json=payload)
    assert response.status_code == 422

@patch("src.services.commander_service.get_llm_provider")
def test_post_commander_explain_inline_trustnet(mock_get_provider):
    import json
    from unittest.mock import MagicMock

    mock_llm = MagicMock()
    mock_res = MagicMock()
    mock_res.content = json.dumps({
        "summary": "Water PLC packetsPerSecond rose 63 percent versus expected 100 during rush_hour."
    })

    async def no_async(*_args, **_kwargs):
        raise RuntimeError("no ainvoke")

    mock_llm.ainvoke = no_async
    mock_llm.invoke.return_value = mock_res
    mock_llm.bind.return_value = mock_llm
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_provider.return_value = mock_provider

    payload = {
        "incidentId": "inc-water-treatment-control-behavioural_anomaly",
        "detection": {
            "incidentId": "inc-water-treatment-control-behavioural_anomaly",
            "timestamp": "2026-08-29T00:00:00Z",
            "detectionType": "behavioural_anomaly",
            "severity": "high",
            "confidence": 0.82,
            "riskScore": 0.77,
            "affectedEndpoints": ["water-treatment-control"],
            "evidence": [
                {
                    "code": "metric_deviation",
                    "metric": "packetsPerSecond",
                    "expected": 100,
                    "observed": 163,
                    "deviationPct": 63,
                }
            ],
            "metadata": {
                "source": "trustnet_detection",
                "cityContext": "rush_hour",
                "sector": "water",
                "criticality": "critical",
            },
        },
    }
    response = client.post("/commander/explain", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["incidentId"] == "inc-water-treatment-control-behavioural_anomaly"
    assert "63" in data["summary"]

