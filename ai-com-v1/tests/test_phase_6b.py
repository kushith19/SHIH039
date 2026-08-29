import pytest
from datetime import datetime
from unittest.mock import MagicMock, patch
from src.models.detection import DetectionInput, CampaignInput, DetectionType, Severity
from src.models.commander import CommanderResponse, Assessment, Impact, Evidence, Recommendation
from src.agent.graph import validate_safety, correct_safety, get_incident_summary

def get_dummy_incident():
    return DetectionInput(
        incidentId="INC-001",
        timestamp=datetime.now(),
        detectionType=DetectionType.behavioral_anomaly,
        severity=Severity.high,
        confidence=0.8,
        riskScore=75.0,
        affectedEndpoints=["server-1"],
        evidence=[],
        metadata={"fusion": False}
    )

def test_campaign_input_schema():
    inc1 = get_dummy_incident()
    inc2 = get_dummy_incident()
    inc2.incident_id = "INC-002"
    
    camp = CampaignInput(
        campaignId="CAMP-001",
        campaignType="cross-sector",
        confidence=0.8,
        incidents=[inc1, inc2],
        correlations=["cor-1"],
        metadata={}
    )
    
    assert camp.campaign_id == "CAMP-001"
    assert len(camp.incidents) == 2

def test_commander_response_mode_validation():
    assessment = Assessment(
        severity="high", confidence=0.9,
        summary="Test"
    )
    impact = Impact(
        affectedEndpoints=[], affectedSectors=[], criticalInfrastructure=[]
    )
    
    # Valid Incident Mode
    resp1 = CommanderResponse(
        analysis_mode="incident",
        incidentId="INC-001",
        assessment=assessment,
        impact=impact
    )
    assert resp1.incident_id == "INC-001"
    
    # Valid Campaign Mode
    resp2 = CommanderResponse(
        analysis_mode="campaign",
        campaignId="CAMP-001",
        assessment=assessment,
        impact=impact
    )
    assert resp2.campaign_id == "CAMP-001"
    
    # Invalid combinations
    with pytest.raises(ValueError):
        CommanderResponse(analysis_mode="incident", campaignId="CAMP-001", assessment=assessment, impact=impact)
        
    with pytest.raises(ValueError):
        CommanderResponse(analysis_mode="campaign", incidentId="INC-001", assessment=assessment, impact=impact)

def test_safety_validator_detection():
    # Setup mock response
    rec_safe = Recommendation(action="Isolate affected network segment.", priority="high", description="safe")
    rec_unsafe = Recommendation(action="Immediately shut down the SCADA controller.", priority="critical", description="unsafe")
    
    resp = CommanderResponse(
        analysis_mode="incident",
        incidentId="INC-001",
        assessment=Assessment(severity="high", confidence=0.8, summary=""),
        impact=Impact(affectedEndpoints=[], affectedSectors=[], criticalInfrastructure=[]),
        recommendations=[rec_safe, rec_unsafe]
    )
    
    state = {"commander_response": resp}
    new_state = validate_safety(state)
    
    assert "unsafe_recs:1" in new_state["validation_errors"]
    assert new_state["safety_validation_latency_ms"] > 0

def test_get_incident_summary_aggregation():
    inc1 = get_dummy_incident()
    inc1.affected_endpoints = ["ep1"]
    inc2 = get_dummy_incident()
    inc2.affected_endpoints = ["ep2"]
    
    camp = CampaignInput(
        campaignId="CAMP-001",
        campaignType="cross-sector",
        confidence=0.8,
        incidents=[inc1, inc2],
        correlations=[],
        metadata={}
    )
    
    state = {"analysis_mode": "campaign", "campaign_input": camp}
    desc, base_term, ep_term, is_comp, log_id, _ = get_incident_summary(state)
    
    assert is_comp is True
    assert log_id == "CAMP-001"
    assert "ep1" in desc and "ep2" in desc
    assert "ep1" in ep_term and "ep2" in ep_term

from unittest.mock import patch, MagicMock

@patch("src.agent.graph.get_llm_provider")
def test_safety_correction_preservation(mock_get_llm_provider):
    # Setup mock LLM
    mock_llm = MagicMock()
    mock_res = MagicMock()
    mock_res.content = '{"action": "Segment the network safely", "priority": "high"}'
    mock_llm.invoke.return_value = mock_res
    if hasattr(mock_llm, "bind"):
        mock_llm.bind.return_value = mock_llm
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_llm_provider.return_value = mock_provider
    
    rec_safe = Recommendation(action="Isolate affected network segment.", priority="high", description="safe")
    rec_unsafe = Recommendation(action="Immediately shut down the SCADA controller.", priority="critical", description="unsafe")
    
    original_assessment = Assessment(severity="high", confidence=0.8, summary="A")
    original_impact = Impact(affectedEndpoints=["E1"], affectedSectors=[], criticalInfrastructure=["CI1"])
    original_evidence = [Evidence(type="C1", description="Text", source="S1", document="D1")]
    
    resp = CommanderResponse(
        analysis_mode="incident",
        incidentId="INC-001",
        assessment=original_assessment,
        impact=original_impact,
        evidence=original_evidence,
        recommendations=[rec_safe, rec_unsafe]
    )
    
    state = {"commander_response": resp, "validation_errors": "unsafe_recs:1", "llm_call_count": 0}
    new_state = correct_safety(state)
    
    new_resp = new_state["commander_response"]
    
    # 1. Unsafe recommendation was replaced
    assert new_resp.recommendations[1].action == "Segment the network safely"
    
    # 2. Everything else MUST be preserved perfectly
    assert new_resp.assessment.summary == "A"
    assert new_resp.impact.affected_endpoints == ["E1"]
    assert new_resp.evidence[0].source == "S1"
    assert new_resp.analysis_mode == "incident"
    assert new_resp.incident_id == "INC-001"
    assert new_resp.recommendations[0].action == "Isolate affected network segment."

@patch("src.agent.graph.get_llm_provider")
def test_correct_safety_drops_when_llm_fails(mock_get_llm_provider):
    mock_llm = MagicMock()
    mock_llm.bind.return_value = mock_llm
    mock_llm.invoke.side_effect = RuntimeError("provider down")
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_llm_provider.return_value = mock_provider

    rec_unsafe = Recommendation(action="Immediately shut down the SCADA controller.", priority="critical", description="unsafe")
    rec_safe = Recommendation(action="Isolate affected network segment.", priority="high", description="safe")
    resp = CommanderResponse(
        analysis_mode="incident",
        incidentId="INC-001",
        assessment=Assessment(severity="high", confidence=0.8, summary="A"),
        impact=Impact(affectedEndpoints=["E1"], affectedSectors=[], criticalInfrastructure=[]),
        evidence=[],
        recommendations=[rec_safe, rec_unsafe],
    )
    new_state = correct_safety({
        "commander_response": resp,
        "validation_errors": "unsafe_recs:1",
        "llm_call_count": 0,
    })
    remaining = [r.action for r in new_state["commander_response"].recommendations]
    assert remaining == ["Isolate affected network segment."]
    assert new_state["validation_errors"] is None

