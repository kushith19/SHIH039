import pytest
from pydantic import ValidationError
from datetime import datetime
from src.models.commander import Evidence
from src.agent.graph import generate_retrieval_plan, assess_evidence_sufficiency
from src.models.detection import DetectionInput, DetectionType, Severity
from src.agent.models import RetrievedEvidence

def test_evidence_page_normalization():
    # Valid integers
    ev1 = Evidence(type="Log", description="Test", page=23)
    assert ev1.page == 23
    
    # Valid string digits
    ev2 = Evidence(type="Log", description="Test", page="23")
    assert ev2.page == 23
    
    # p. format
    ev3 = Evidence(type="Log", description="Test", page="p. 23")
    assert ev3.page == 23
    
    # page format
    ev4 = Evidence(type="Log", description="Test", page="page 23")
    assert ev4.page == 23
    
    # Invalid string but shouldn't error, just stay as original value and let Pydantic handle it 
    # Actually Pydantic will raise ValidationError if it doesn't parse to int eventually
    with pytest.raises(ValidationError):
        Evidence(type="Log", description="Test", page="twenty three")

def test_planner_deterministic_path():
    det = DetectionInput(
        incident_id="INC-TEST",
        timestamp=datetime.now(),
        detection_type=DetectionType.behavioral_anomaly,
        severity=Severity.high,
        confidence=0.8,
        risk_score=80.0,
        affected_endpoints=["workstation-1"],
        metadata={"source": "EDR"}
    )
    state = {"analysis_mode": "incident", "incident_input": det}
    result = generate_retrieval_plan(state)
    
    assert result["planner_mode"] == "deterministic"
    assert "retrieval_plan" in result
    assert result["llm_call_count"] == 0

def test_planner_llm_fallback_for_complex():
    det = DetectionInput(
        incident_id="INC-TEST-COMPLEX",
        timestamp=datetime.now(),
        detection_type=DetectionType.behavioral_anomaly,
        severity=Severity.high,
        confidence=0.8,
        risk_score=80.0,
        affected_endpoints=["workstation-1", "server-1", "plc-1", "hmi-1"], # >= 4
        metadata={"source": "EDR"}
    )
    state = {"analysis_mode": "incident", "incident_input": det, "llm_call_count": 0}
    result = generate_retrieval_plan(state)
    assert result["planner_mode"] in ["llm", "fallback"]

def test_sufficiency_configurable_thresholds(monkeypatch):
    monkeypatch.setenv("SUFFICIENCY_MIN_EVIDENCE", "2")
    monkeypatch.setenv("SUFFICIENCY_MIN_SCORE", "0.40")
    monkeypatch.setenv("SUFFICIENCY_MIN_CATEGORIES", "1")
    
    det = DetectionInput(
        incident_id="INC-TEST",
        timestamp=datetime.now(),
        detection_type=DetectionType.behavioral_anomaly,
        severity=Severity.high,
        confidence=0.8,
        risk_score=80.0,
        affected_endpoints=["workstation-1"],
        metadata={"source": "EDR"}
    )
    
    ev_list = [
        RetrievedEvidence(
            retrieval_queries=["test"],
            score=0.45,
            source="test",
            document_name="test_doc",
            category="incident-response",
            chunk_id="1",
            text="test"
        ),
        RetrievedEvidence(
            retrieval_queries=["test"],
            score=0.45,
            source="test",
            document_name="test_doc",
            category="incident-response",
            chunk_id="2",
            text="test"
        )
    ]
    
    state = {"analysis_mode": "incident", "incident_input": det, "retrieved_evidence": ev_list}
    result = assess_evidence_sufficiency(state)
    
    assert result["sufficiency_llm_invoked"] is False
    assert result["evidence_sufficiency"].sufficient is True
