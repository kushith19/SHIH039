import pytest
from src.agent.graph import get_incident_summary, AgentState
from src.models.detection import DetectionInput, Severity, DetectionType, CampaignInput
from datetime import datetime

def test_complexity_classifier():
    # Simple Incident
    det_simple = DetectionInput(
        incident_id="INC-1",
        timestamp=datetime.now(),
        detection_type=DetectionType.behavioral_anomaly,
        severity=Severity.high,
        confidence=0.8,
        risk_score=50.0,
        affected_endpoints=["ep-1", "ep-2"],
        metadata={}
    )
    
    state_simple: AgentState = {"analysis_mode": "incident", "incident_input": det_simple}
    _, _, _, is_complex, _, _ = get_incident_summary(state_simple)
    assert is_complex is False

    # Complex Incident: >3 endpoints
    det_endpoints = DetectionInput(
        incident_id="INC-2",
        timestamp=datetime.now(),
        detection_type=DetectionType.behavioral_anomaly,
        severity=Severity.high,
        confidence=0.8,
        risk_score=50.0,
        affected_endpoints=["ep-1", "ep-2", "ep-3", "ep-4"],
        metadata={}
    )
    state_endpoints: AgentState = {"analysis_mode": "incident", "incident_input": det_endpoints}
    _, _, _, is_complex, _, _ = get_incident_summary(state_endpoints)
    assert is_complex is True
    
    # Complex Incident: Fusion metadata
    det_fusion = DetectionInput(
        incident_id="INC-3",
        timestamp=datetime.now(),
        detection_type=DetectionType.behavioral_anomaly,
        severity=Severity.high,
        confidence=0.8,
        risk_score=50.0,
        affected_endpoints=["ep-1"],
        metadata={"notes": "Data fusion alert"}
    )
    state_fusion: AgentState = {"analysis_mode": "incident", "incident_input": det_fusion}
    _, _, _, is_complex, _, _ = get_incident_summary(state_fusion)
    assert is_complex is True

    # Complex Incident: Cross-sector (IT + OT)
    det_cross = DetectionInput(
        incident_id="INC-4",
        timestamp=datetime.now(),
        detection_type=DetectionType.behavioral_anomaly,
        severity=Severity.high,
        confidence=0.8,
        risk_score=50.0,
        affected_endpoints=["plc-1", "smart-grid-1"], # 'plc' implies OT, 'smart' implies IT
        metadata={}
    )
    state_cross: AgentState = {"analysis_mode": "incident", "incident_input": det_cross}
    _, _, _, is_complex, _, _ = get_incident_summary(state_cross)
    assert is_complex is True

    # Campaign is always complex
    camp = CampaignInput(
        campaign_id="CAMP-1",
        campaign_type="APT",
        confidence=0.8,
        incidents=[det_simple]
    )
    state_camp: AgentState = {"analysis_mode": "campaign", "campaign_input": camp}
    _, _, _, is_complex, _, _ = get_incident_summary(state_camp)
    assert is_complex is True
