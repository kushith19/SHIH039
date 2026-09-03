"""Knowledge-only retrieval helpers.

Reuses VectorRetriever + deterministic query planning from the LangGraph path
without generating a response plan or executing actions.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from src.agent.models import (
    KnowledgeCategory,
    RetrievalPlan,
    RetrievalPriority,
    RetrievalQuery,
    RetrievedEvidence,
)
from src.models.detection import DetectionInput
from src.rag.retriever import VectorRetriever

logger = logging.getLogger(__name__)

FORBIDDEN_KNOWLEDGE_KEYS = frozenset(
    {
        "responsePlan",
        "response_plan",
        "actionId",
        "action_id",
        "actions",
        "executable",
        "execute",
        "quarantine",
    }
)


def _incident_desc_from_detection(det: DetectionInput) -> Tuple[str, str, str]:
    incident_desc = (
        f"{det.detection_type.value} {str(det.metadata)} {' '.join(det.affected_endpoints)}"
    ).lower()
    base_term = str(det.detection_type.value).replace("_", " ")
    endpoints_term = " ".join(det.affected_endpoints)
    return incident_desc, base_term, endpoints_term


def build_deterministic_retrieval_plan(
    *,
    detection: Optional[DetectionInput] = None,
    query_override: Optional[str] = None,
    hints: Optional[Dict[str, Any]] = None,
) -> RetrievalPlan:
    """Build up to 4 retrieval queries without an LLM planner call."""
    hints = hints or {}
    if query_override and str(query_override).strip():
        q = str(query_override).strip()
        return RetrievalPlan(
            queries=[
                RetrievalQuery(
                    query=q,
                    rationale="Compact incident-aware query from live SOC context",
                    priority=RetrievalPriority.HIGH,
                )
            ]
        )

    if detection is not None:
        incident_desc, base_term, endpoints_term = _incident_desc_from_detection(detection)
    else:
        parts = [
            str(hints.get("incidentType") or hints.get("detectionType") or ""),
            str(hints.get("asset") or ""),
            str(hints.get("sector") or ""),
            " ".join(str(x) for x in (hints.get("evidenceHints") or [])),
            str(hints.get("query") or ""),
        ]
        incident_desc = " ".join(p for p in parts if p).lower()
        base_term = (
            str(hints.get("incidentType") or hints.get("detectionType") or "behavioral anomaly")
            .replace("_", " ")
            .strip()
            or "behavioral anomaly"
        )
        endpoints_term = str(hints.get("asset") or hints.get("sector") or "").strip()

    domains: List[str] = ["incident-response"]
    if any(
        k in incident_desc
        for k in ["water", "traffic", "control", "scada", "plc", "ot", "ics", "substation"]
    ):
        domains.append("ot-ics")
    if any(
        k in incident_desc for k in ["smart", "municipal", "city", "auth", "server", "cloud"]
    ):
        domains.append("smart-city")
    if "india" in incident_desc or "cigu" in incident_desc or "nciipc" in incident_desc:
        domains.append("india")

    queries: List[RetrievalQuery] = [
        RetrievalQuery(
            query=f"{base_term} {endpoints_term}".strip(),
            rationale="Deterministic query for primary detection",
            priority=RetrievalPriority.HIGH,
        )
    ]
    for d in domains:
        cat = None
        try:
            cat = KnowledgeCategory(d)
        except ValueError:
            cat = None
        queries.append(
            RetrievalQuery(
                query=f"{base_term} {d}",
                category=cat,
                rationale=f"Deterministic query for domain: {d}",
                priority=RetrievalPriority.MEDIUM,
            )
        )
    return RetrievalPlan(queries=queries[:4])


def diversify_chunks(
    evidence: List[RetrievedEvidence], *, max_chunks: int = 5
) -> List[RetrievedEvidence]:
    if not evidence:
        return []
    highest_score = max(ev.score for ev in evidence)
    threshold = highest_score * 0.90
    competitive = [ev for ev in evidence if ev.score >= threshold]
    weak = [ev for ev in evidence if ev.score < threshold]

    groups: Dict[Tuple[str, str], List[RetrievedEvidence]] = defaultdict(list)
    for ev in competitive:
        groups[(ev.category, ev.document_name)].append(ev)
    for g in groups.values():
        g.sort(key=lambda x: x.score, reverse=True)

    selected: List[RetrievedEvidence] = []
    group_keys = sorted(groups.keys(), key=lambda k: groups[k][0].score, reverse=True)
    while group_keys and len(selected) < max_chunks:
        for k in list(group_keys):
            if groups[k]:
                selected.append(groups[k].pop(0))
                if len(selected) >= max_chunks:
                    break
            else:
                group_keys.remove(k)

    if len(selected) < max_chunks and weak:
        weak.sort(key=lambda x: x.score, reverse=True)
        selected.extend(weak[: max_chunks - len(selected)])
    return selected[:max_chunks]


def retrieve_knowledge_chunks(
    retriever: VectorRetriever,
    plan: RetrievalPlan,
    *,
    top_k: int = 3,
    max_chunks: int = 5,
) -> Tuple[List[RetrievedEvidence], str]:
    """Execute a retrieval plan; returns (chunks, retrieval_status)."""
    if not plan or not plan.queries:
        return [], "unavailable"

    all_evidence: Dict[str, RetrievedEvidence] = {}
    any_success = False
    for q in plan.queries:
        filters: Dict[str, Any] = {}
        if q.category:
            filters["category"] = q.category.value
        if q.source:
            filters["source"] = q.source
        try:
            result = retriever.retrieve(
                q.query, top_k=top_k, filters=filters if filters else None
            )
            any_success = True
            for chunk in result.results:
                if chunk.chunk_id in all_evidence:
                    if q.query not in all_evidence[chunk.chunk_id].retrieval_queries:
                        all_evidence[chunk.chunk_id].retrieval_queries.append(q.query)
                else:
                    all_evidence[chunk.chunk_id] = RetrievedEvidence(
                        retrieval_queries=[q.query],
                        score=chunk.score,
                        source=chunk.source,
                        document_name=chunk.document_name,
                        category=chunk.category,
                        section=chunk.section,
                        page_number=chunk.page_number,
                        chunk_id=chunk.chunk_id,
                        text=chunk.text,
                    )
        except Exception as e:
            logger.error("Knowledge retrieval failed for query %r: %s", q.query, e)

    if not all_evidence:
        return [], "unavailable" if not any_success else "unavailable"

    selected = diversify_chunks(list(all_evidence.values()), max_chunks=max_chunks)
    if not selected:
        return [], "unavailable"
    status = "partial" if len(selected) < len(plan.queries) else "success"
    return selected, status


def strip_forbidden_keys(data: Any) -> Any:
    """Remove execution/plan keys from LLM JSON (defense in depth)."""
    if isinstance(data, dict):
        return {
            k: strip_forbidden_keys(v)
            for k, v in data.items()
            if k not in FORBIDDEN_KNOWLEDGE_KEYS
        }
    if isinstance(data, list):
        return [strip_forbidden_keys(x) for x in data]
    return data


def chunks_to_sources(chunks: List[RetrievedEvidence]) -> List[Dict[str, Any]]:
    sources = []
    seen = set()
    for ev in chunks:
        key = (ev.document_name, ev.source, ev.section, ev.page_number)
        if key in seen:
            continue
        seen.add(key)
        sources.append(
            {
                "document": ev.document_name,
                "source": ev.source,
                "section": ev.section,
                "page": ev.page_number,
                "score": round(float(ev.score), 4) if ev.score is not None else None,
                "category": ev.category,
            }
        )
    return sources


def fallback_structure_from_chunks(
    chunks: List[RetrievedEvidence],
) -> Dict[str, List[Any]]:
    """Deterministic mapping when LLM structuring fails."""
    relevant = []
    for ev in chunks[:5]:
        excerpt = (ev.text or "").strip().replace("\n", " ")
        if len(excerpt) > 280:
            excerpt = excerpt[:277] + "..."
        if excerpt:
            relevant.append(excerpt)
    return {
        "attackUnderstanding": [],
        "relevantKnowledge": relevant,
        "preventionGuidance": [],
        "sources": chunks_to_sources(chunks),
    }
