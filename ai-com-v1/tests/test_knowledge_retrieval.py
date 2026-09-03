"""Unit tests for knowledge-only RAG helpers (no Qdrant required)."""

from src.agent.knowledge_retrieval import (
    build_deterministic_retrieval_plan,
    diversify_chunks,
    strip_forbidden_keys,
    fallback_structure_from_chunks,
    chunks_to_sources,
)
from src.agent.models import RetrievedEvidence
from src.models.detection import DetectionInput, DetectionType, Severity
from datetime import datetime, timezone


def test_deterministic_plan_from_detection():
    det = DetectionInput(
        incidentId="INC-K1",
        timestamp=datetime.now(timezone.utc),
        detectionType=DetectionType.behavioral_anomaly,
        severity=Severity.high,
        confidence=0.9,
        riskScore=0.8,
        affectedEndpoints=["payment-gateway"],
        evidence=[{"code": "metric_deviation", "metric": "packetsPerSecond"}],
        metadata={"sector": "finance"},
    )
    plan = build_deterministic_retrieval_plan(detection=det)
    assert 1 <= len(plan.queries) <= 4
    assert "behavioral" in plan.queries[0].query.lower() or "payment" in plan.queries[0].query.lower()


def test_query_override_single_query():
    plan = build_deterministic_retrieval_plan(
        query_override="traffic flood payment packets per second"
    )
    assert len(plan.queries) == 1
    assert "traffic flood" in plan.queries[0].query


def test_strip_forbidden_keys_removes_execution():
    raw = {
        "attackUnderstanding": ["flood pattern"],
        "responsePlan": [{"action": "isolate"}],
        "actionId": "isolate-node",
        "relevantKnowledge": ["rate limiting"],
        "nested": {"execute": "bad", "ok": 1},
    }
    cleaned = strip_forbidden_keys(raw)
    assert "responsePlan" not in cleaned
    assert "actionId" not in cleaned
    assert "execute" not in cleaned["nested"]
    assert cleaned["nested"]["ok"] == 1
    assert cleaned["attackUnderstanding"] == ["flood pattern"]


def test_fallback_structure_and_sources():
    chunks = [
        RetrievedEvidence(
            retrieval_queries=["q"],
            score=0.9,
            source="NIST",
            document_name="SP-800-61",
            category="incident-response",
            section="Containment",
            page_number=12,
            chunk_id="c1",
            text="Volumetric floods can exhaust resources.",
        )
    ]
    structured = fallback_structure_from_chunks(chunks)
    assert structured["relevantKnowledge"]
    assert structured["sources"][0]["document"] == "SP-800-61"
    assert chunks_to_sources(chunks)[0]["source"] == "NIST"


def test_diversify_caps_at_five():
    chunks = [
        RetrievedEvidence(
            retrieval_queries=["q"],
            score=1.0 - (i * 0.01),
            source="S",
            document_name=f"doc-{i % 3}",
            category="iot",
            section=None,
            page_number=None,
            chunk_id=f"id-{i}",
            text=f"text {i}",
        )
        for i in range(12)
    ]
    selected = diversify_chunks(chunks, max_chunks=5)
    assert len(selected) <= 5
