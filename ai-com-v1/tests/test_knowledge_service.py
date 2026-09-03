"""Knowledge enrichment soft-fail and plan isolation (mocked retriever)."""

import asyncio

from src.services.commander_service import CommanderService, _unavailable_knowledge
from src.agent.knowledge_retrieval import strip_forbidden_keys
from src.rag.retriever import RetrievalResult
from src.rag.models.document import RetrievedChunk, DocumentMetadata, RetrievalResult as RR


def _meta(name="NIST.SP.800-61r3", source="NIST", category="incident-response"):
    return DocumentMetadata(
        category=category,
        source=source,
        document_name=name,
        document_type="pdf",
        document_hash="h" * 64,
    )


def _chunk(i=0, name=None, source="NIST"):
    doc = name or f"doc-{i}"
    return RetrievedChunk(
        chunk_id=f"c{i}" + ("0" * 62),
        text="Traffic flooding commonly causes resource exhaustion and service degradation.",
        score=0.91 - i * 0.01,
        rank=i + 1,
        source=source,
        document_name=doc,
        category="incident-response",
        section="Containment",
        page_number=10,
        metadata=_meta(name=doc, source=source),
    )


class FakeRetriever:
    def __init__(self, chunks=None, fail=False):
        self.chunks = chunks or []
        self.fail = fail

    def retrieve(self, query, top_k=5, filters=None):
        if self.fail:
            raise RuntimeError("qdrant down")
        return RR(
            results=self.chunks[:top_k],
            embedding_latency_ms=1.0,
            search_latency_ms=1.0,
            total_latency_ms=2.0,
        )


def test_unavailable_helper():
    kc = _unavailable_knowledge()
    assert kc.retrieved is False
    assert kc.knowledge_status == "unavailable"


def test_enrich_knowledge_soft_fails_on_retriever_error():
    svc = CommanderService(retriever=FakeRetriever(fail=True))
    kc = asyncio.run(svc.enrich_knowledge(query="behavioral anomaly payment flood"))
    assert kc.retrieved is False
    assert "unavailable" in (kc.reason or "").lower()


def test_enrich_knowledge_fallback_structure_without_llm(monkeypatch):
    chunks = [
        _chunk(0, name="NIST.SP.800-61r3", source="NIST"),
        _chunk(1, name="ICS-ATTCK", source="MITRE"),
    ]
    svc = CommanderService(retriever=FakeRetriever(chunks=chunks))

    async def boom(*_a, **_k):
        raise RuntimeError("llm down")

    monkeypatch.setattr(svc, "_structure_knowledge_llm", boom)

    kc = asyncio.run(svc.enrich_knowledge(query="payment flood packets"))
    assert kc.retrieved is True
    assert kc.relevant_knowledge or kc.attack_understanding
    dumped = kc.model_dump(by_alias=True)
    assert "responsePlan" not in dumped
    assert "actionId" not in dumped


def test_enrich_knowledge_live_path_skips_llm_by_default(monkeypatch):
    """Live Commander must not block on Ollama structuring."""
    chunks = [
        _chunk(0, name="NIST.SP.800-82r3", source="NIST"),
    ]
    svc = CommanderService(retriever=FakeRetriever(chunks=chunks))
    called = {"n": 0}

    async def track(*_a, **_k):
        called["n"] += 1
        await asyncio.sleep(30)
        return {"attackUnderstanding": ["should not wait"]}

    monkeypatch.setattr(svc, "_structure_knowledge_llm", track)
    monkeypatch.delenv("KNOWLEDGE_LLM_STRUCTURE", raising=False)

    kc = asyncio.run(svc.enrich_knowledge(query="ics anomaly"))
    assert called["n"] == 0
    assert kc.retrieved is True
    assert kc.knowledge_status in ("success", "degraded")
    assert kc.relevant_knowledge or kc.sources


def test_enrich_knowledge_optional_llm_times_out_to_fallback(monkeypatch):
    chunks = [
        _chunk(0, name="NIST.SP.800-82r3", source="NIST"),
    ]
    svc = CommanderService(retriever=FakeRetriever(chunks=chunks))

    async def slow(*_a, **_k):
        await asyncio.sleep(30)
        return {"attackUnderstanding": ["too late"]}

    monkeypatch.setattr(svc, "_structure_knowledge_llm", slow)
    monkeypatch.setenv("KNOWLEDGE_LLM_STRUCTURE", "1")
    monkeypatch.setenv("KNOWLEDGE_STRUCTURE_TIMEOUT_S", "0.5")

    t0 = __import__("time").time()
    kc = asyncio.run(svc.enrich_knowledge(query="ics anomaly"))
    elapsed = __import__("time").time() - t0
    assert kc.retrieved is True
    assert elapsed < 5.0
    assert kc.relevant_knowledge or kc.sources


def test_strip_forbidden_in_enrich_path():
    cleaned = strip_forbidden_keys(
        {
            "attackUnderstanding": ["x"],
            "responsePlan": [{"actionId": "isolate-node"}],
            "actionId": "isolate-node",
        }
    )
    assert "responsePlan" not in cleaned
    assert "actionId" not in cleaned
