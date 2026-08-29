import pytest
import json
import os
from unittest.mock import MagicMock, patch

# Disable bypass by default for these tests
os.environ["SUFFICIENCY_MIN_SCORE"] = "2.0"

from src.models.detection import DetectionInput
from src.models.commander import CommanderResponse
from src.agent.llm_provider import LLMProvider, OllamaProvider, get_llm_provider
from src.agent.graph import create_commander_graph
from src.agent.models import RetrievalPlan, RetrievalQuery, RetrievalPriority, RetrievedEvidence, KnowledgeCategory
from src.rag.models.document import RetrievedChunk, DocumentMetadata

@pytest.fixture
def mock_detection():
    return DetectionInput(
        incidentId="INC-001",
        timestamp="2026-08-26T00:00:00Z",
        detectionType="behavioral_anomaly",
        severity="high",
        confidence=0.91,
        riskScore=0.91,
        affectedEndpoints=["node1", "node2", "node3", "node4"], # Complex to force LLM planner
        evidence=[],
        metadata={}
    )

@pytest.fixture
def mock_retriever():
    retriever = MagicMock()
    # Mock retrieve to return a single fake chunk
    mock_result = MagicMock()
    mock_result.results = [
        RetrievedChunk(
            chunk_id="chunk-123",
            text="Mock guidance for incident response",
            score=0.95,
            source="NIST",
            document_name="NIST_SP",
            category="incident-response",
            rank=1,
            metadata=DocumentMetadata(
                category="incident-response",
                source="NIST",
                document_name="NIST_SP",
                document_type="pdf",
                document_hash="hash"
            )
        )
    ]
    retriever.retrieve.return_value = mock_result
    return retriever

def test_unsupported_provider():
    with patch("src.config.settings.settings.llm_provider", "invalid"):
        with pytest.raises(ValueError, match="Unsupported LLM_PROVIDER configured: 'invalid'"):
            get_llm_provider()

def test_ollama_provider_init_missing_config():
    with patch("src.config.settings.settings.ollama_base_url", ""):
        with pytest.raises(ValueError, match="Ollama configuration"):
            OllamaProvider()

@pytest.mark.asyncio
@patch("src.agent.graph.get_llm_provider")
async def test_successful_structured_llm_response(mock_get_provider, mock_detection, mock_retriever):
    mock_llm = MagicMock()
    
    # First response: Query planner
    plan_response = MagicMock()
    plan_response.content = json.dumps({
        "queries": [
            {
                "query": "test query",
                "category": "incident-response",
                "rationale": "test",
                "priority": "high"
            }
        ]
    })
    
    # Second response: Assessment generator
    assessment_response = MagicMock()
    assessment_response.content = json.dumps({
        "incidentId": "INC-001",
        "assessment": {"severity": "high", "summary": "Test summary", "confidence": 0.9},
        "impact": {"affectedEndpoints": ["node1"], "affectedSectors": [], "criticalInfrastructure": []},
        "evidence": [],
        "recommendations": []
    })
    
    sufficiency_response = MagicMock()
    sufficiency_response.content = json.dumps({
        "sufficient": True,
        "confidence": 0.9,
        "missing_domains": [],
        "rationale": "test"
    })
    
    mock_llm.invoke.side_effect = [plan_response, sufficiency_response, assessment_response]
    mock_llm.bind.return_value = mock_llm
    
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_provider.return_value = mock_provider
    
    graph = create_commander_graph(retriever=mock_retriever)
    initial_state = {
        "analysis_mode": "incident",
        "incident_input": mock_detection,
        "raw_llm_output": None,
        "commander_response": None,
        "error": None
    }
    
    final_state = await graph.ainvoke(initial_state)
    
    assert final_state["error"] is None
    assert final_state["retrieval_status"] == "success"
    assert len(final_state["retrieved_evidence"]) == 1
    assert final_state["retrieved_evidence"][0].chunk_id == "chunk-123"
    assert isinstance(final_state["commander_response"], CommanderResponse)
    assert final_state["commander_response"].incident_id == "INC-001"
    assert final_state["commander_response"].assessment.severity == "high"

@pytest.mark.asyncio
@patch("src.agent.graph.get_llm_provider")
async def test_invalid_llm_output_handling_correction_succeeds(mock_get_provider, mock_detection, mock_retriever):
    mock_llm = MagicMock()
    
    # First response: Query planner
    plan_response = MagicMock()
    plan_response.content = json.dumps({
        "queries": [{"query": "test query", "rationale": "test", "priority": "high"}]
    })
    
    # Second response: Invalid JSON assessment
    assessment_response_invalid = MagicMock()
    assessment_response_invalid.content = "This is not JSON"
    
    # Third response: Valid JSON after correction
    assessment_response_valid = MagicMock()
    assessment_response_valid.content = json.dumps({
        "incidentId": "INC-001",
        "assessment": {"severity": "high", "summary": "Test summary", "confidence": 0.9},
        "impact": {"affectedEndpoints": ["node1"], "affectedSectors": [], "criticalInfrastructure": []},
        "evidence": [],
        "recommendations": []
    })
    
    sufficiency_response = MagicMock()
    sufficiency_response.content = json.dumps({"sufficient": True, "confidence": 0.9, "missing_domains": [], "rationale": "test"})
    
    mock_llm.invoke.side_effect = [plan_response, sufficiency_response, assessment_response_invalid, assessment_response_valid]
    mock_llm.bind.return_value = mock_llm
    
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_provider.return_value = mock_provider
    
    graph = create_commander_graph(retriever=mock_retriever)
    initial_state = {
        "analysis_mode": "incident",
        "incident_input": mock_detection,
        "raw_llm_output": None,
        "commander_response": None,
        "error": None
    }
    
    final_state = await graph.ainvoke(initial_state)
    
    assert final_state["error"] is None
    assert final_state["commander_response"] is not None
    assert final_state["correction_attempts"] == 1

@pytest.mark.asyncio
@patch("src.agent.graph.get_llm_provider")
async def test_invalid_llm_output_handling_correction_fails(mock_get_provider, mock_detection, mock_retriever):
    mock_llm = MagicMock()
    
    # First response: Query planner
    plan_response = MagicMock()
    plan_response.content = json.dumps({
        "queries": [{"query": "test query", "rationale": "test", "priority": "high"}]
    })
    
    # Second response: Invalid JSON assessment
    assessment_response_invalid1 = MagicMock()
    assessment_response_invalid1.content = "This is not JSON"
    
    # Third response: Still invalid JSON assessment
    assessment_response_invalid2 = MagicMock()
    assessment_response_invalid2.content = "Still not JSON"
    
    sufficiency_response = MagicMock()
    sufficiency_response.content = json.dumps({"sufficient": True, "confidence": 0.9, "missing_domains": [], "rationale": "test"})
    
    mock_llm.invoke.side_effect = [plan_response, sufficiency_response, assessment_response_invalid1, assessment_response_invalid2]
    mock_llm.bind.return_value = mock_llm
    
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_provider.return_value = mock_provider
    
    graph = create_commander_graph(retriever=mock_retriever)
    initial_state = {
        "analysis_mode": "incident",
        "incident_input": mock_detection,
        "raw_llm_output": None,
        "commander_response": None,
        "error": None
    }
    
    final_state = await graph.ainvoke(initial_state)
    
    assert final_state["error"] == "Malformed LLM output - Invalid JSON"
    assert final_state["commander_response"] is None
    assert final_state["correction_attempts"] == 1

@pytest.mark.asyncio
@patch("src.agent.graph.get_llm_provider")
async def test_ollama_unavailable_handling(mock_get_provider, mock_detection, mock_retriever):
    mock_llm = MagicMock()
    mock_llm.invoke.side_effect = Exception("Connection refused")
    mock_llm.bind.return_value = mock_llm
    
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_provider.return_value = mock_provider
    
    graph = create_commander_graph(retriever=mock_retriever)
    initial_state = {
        "analysis_mode": "incident",
        "incident_input": mock_detection,
        "raw_llm_output": None,
        "commander_response": None,
        "error": None
    }
    
    final_state = await graph.ainvoke(initial_state)
    
    # Should fallback planner to default, then fail on assessment
    assert final_state["retrieval_plan"] is not None
    assert final_state["retrieval_plan"].queries[0].query == "behavioral anomaly"
    assert "LLM invocation failed" in final_state["error"]
    assert final_state["commander_response"] is None

@pytest.mark.asyncio
@patch("src.agent.graph.get_llm_provider")
async def test_retrieval_empty_results(mock_get_provider, mock_detection):
    mock_retriever = MagicMock()
    empty_result = MagicMock()
    empty_result.results = []
    mock_retriever.retrieve.return_value = empty_result

    mock_llm = MagicMock()
    plan_response = MagicMock()
    plan_response.content = json.dumps({
        "queries": [{"query": "test query", "rationale": "test", "priority": "high"}]
    })
    assessment_response = MagicMock()
    assessment_response.content = json.dumps({
        "incidentId": "INC-001",
        "assessment": {"severity": "high", "summary": "Test summary", "confidence": 0.9},
        "impact": {"affectedEndpoints": ["node1"], "affectedSectors": [], "criticalInfrastructure": []},
        "evidence": [],
        "recommendations": []
    })
    sufficiency_response = MagicMock()
    sufficiency_response.content = json.dumps({"sufficient": True, "confidence": 0.9, "missing_domains": [], "rationale": "test"})
    mock_llm.invoke.side_effect = [plan_response, sufficiency_response, assessment_response]
    mock_llm.bind.return_value = mock_llm
    
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_provider.return_value = mock_provider
    
    graph = create_commander_graph(retriever=mock_retriever)
    initial_state = {
        "analysis_mode": "incident",
        "incident_input": mock_detection,
        "raw_llm_output": None,
        "commander_response": None,
        "error": None
    }
    
    final_state = await graph.ainvoke(initial_state)
    
    assert final_state["error"] is None
    assert final_state["retrieval_status"] == "unavailable"
    assert len(final_state["retrieved_evidence"]) == 0

@pytest.mark.asyncio
@patch("src.agent.graph.get_llm_provider")
async def test_targeted_retrieval_flow(mock_get_provider, mock_detection, mock_retriever):
    mock_llm = MagicMock()
    
    plan_response = MagicMock()
    plan_response.content = json.dumps({
        "queries": [{"query": "test query", "rationale": "test", "priority": "high"}]
    })
    
    # Sufficiency says False, triggers targeted retrieval
    sufficiency_response = MagicMock()
    sufficiency_response.content = json.dumps({
        "sufficient": False, 
        "confidence": 0.9, 
        "missing_domains": ["ot_ics"], 
        "rationale": "missing OT context"
    })
    
    assessment_response = MagicMock()
    assessment_response.content = json.dumps({
        "incidentId": "INC-001",
        "assessment": {"severity": "high", "summary": "Test summary", "confidence": 0.9},
        "impact": {"affectedEndpoints": ["node1"], "affectedSectors": [], "criticalInfrastructure": []},
        "evidence": [],
        "recommendations": []
    })
    
    mock_llm.invoke.side_effect = [plan_response, sufficiency_response, assessment_response]
    mock_llm.bind.return_value = mock_llm
    
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_provider.return_value = mock_provider
    
    # Make the retriever return 1 chunk first, then 1 new chunk on targeted
    mock_result_1 = MagicMock()
    mock_result_1.results = [
        RetrievedChunk(chunk_id="chunk-1", text="chunk 1", score=0.9, source="A", document_name="DocA", category="C", rank=1, metadata=DocumentMetadata(category="C", source="A", document_name="DocA", document_type="pdf", document_hash="1"))
    ]
    mock_result_2 = MagicMock()
    mock_result_2.results = [
        RetrievedChunk(chunk_id="chunk-2", text="chunk 2", score=0.85, source="B", document_name="DocB", category="D", rank=1, metadata=DocumentMetadata(category="D", source="B", document_name="DocB", document_type="pdf", document_hash="2"))
    ]
    mock_retriever.retrieve.side_effect = [mock_result_1, mock_result_2]
    
    graph = create_commander_graph(retriever=mock_retriever)
    initial_state = {
        "analysis_mode": "incident",
        "incident_input": mock_detection,
        "raw_llm_output": None,
        "commander_response": None,
        "error": None
    }
    
    final_state = await graph.ainvoke(initial_state)
    
    assert final_state["error"] is None
    assert final_state["targeted_retrieval_used"] is True
    assert final_state["additional_chunks_retrieved"] == 1
    assert len(final_state["retrieved_evidence"]) == 2

@pytest.mark.asyncio
@patch("src.agent.graph.get_llm_provider")
async def test_deterministic_bypass(mock_get_provider, mock_detection, mock_retriever):
    mock_llm = MagicMock()
    
    plan_response = MagicMock()
    plan_response.content = json.dumps({
        "queries": [{"query": "test query", "rationale": "test", "priority": "high"}]
    })
    
    assessment_response = MagicMock()
    assessment_response.content = json.dumps({
        "incidentId": "INC-001",
        "assessment": {"severity": "high", "summary": "Test summary", "confidence": 0.9},
        "impact": {"affectedEndpoints": ["node1"], "affectedSectors": [], "criticalInfrastructure": []},
        "evidence": [],
        "recommendations": []
    })
    
    # We should only invoke plan and assessment (2 calls). Sufficiency is skipped.
    mock_llm.invoke.side_effect = [plan_response, assessment_response]
    mock_llm.bind.return_value = mock_llm
    
    mock_provider = MagicMock()
    mock_provider.get_model.return_value = mock_llm
    mock_get_provider.return_value = mock_provider
    
    mock_result = MagicMock()
    mock_result.results = [
        RetrievedChunk(chunk_id="chunk-1", text="chunk 1", score=0.9, source="A", document_name="DocA", category="incident-response", rank=1, metadata=DocumentMetadata(category="incident-response", source="A", document_name="DocA", document_type="pdf", document_hash="1")),
        RetrievedChunk(chunk_id="chunk-2", text="chunk 2", score=0.88, source="B", document_name="DocB", category="ot-ics", rank=2, metadata=DocumentMetadata(category="ot-ics", source="B", document_name="DocB", document_type="pdf", document_hash="2")),
        RetrievedChunk(chunk_id="chunk-3", text="chunk 3", score=0.86, source="C", document_name="DocC", category="smart-city", rank=3, metadata=DocumentMetadata(category="smart-city", source="C", document_name="DocC", document_type="pdf", document_hash="3"))
    ]
    mock_retriever.retrieve.return_value = mock_result
    
    graph = create_commander_graph(retriever=mock_retriever)
    
    # Enable bypass for this specific test
    os.environ["SUFFICIENCY_MIN_SCORE"] = "0.5"
    
    # Let's adjust the detection to ensure we hit the ot-ics requirement so it gets satisfied
    mock_detection.affected_endpoints = ["water-treatment-control"]
    
    initial_state = {
        "analysis_mode": "incident",
        "incident_input": mock_detection,
        "raw_llm_output": None,
        "commander_response": None,
        "error": None
    }
    
    final_state = await graph.ainvoke(initial_state)
    
    assert final_state["error"] is None
    assert final_state["sufficiency_llm_invoked"] is False
    assert final_state["llm_call_count"] == 2
