"""Risk components from observed detection fields. Mirrors shared/commanderRisk.js."""

from __future__ import annotations

from typing import Any, Mapping, Optional


CRIT = {
    "critical": 95,
    "high": 80,
    "medium": 50,
    "low": 25,
}


def _clamp100(n: Any) -> Optional[int]:
    try:
        v = float(n)
    except (TypeError, ValueError):
        return None
    if v != v:  # NaN
        return None
    return max(0, min(100, int(round(v))))


def criticality_component(criticality: Any) -> int:
    key = str(criticality or "").lower()
    return CRIT.get(key, 40)


def behavioral_component(evidence: Any, anomaly_score: Any) -> Optional[int]:
    max_dev = 0.0
    found = False
    for ev in evidence or []:
        if not isinstance(ev, Mapping):
            continue
        try:
            d = abs(float(ev.get("deviationPct")))
        except (TypeError, ValueError):
            continue
        found = True
        max_dev = max(max_dev, d)
    if found:
        return _clamp100(min(100.0, max_dev))
    try:
        a = float(anomaly_score)
    except (TypeError, ValueError):
        return None
    return _clamp100(a * 100.0 if a <= 1 else a)


def graph_component(anomaly_score: Any) -> Optional[int]:
    try:
        a = float(anomaly_score)
    except (TypeError, ValueError):
        return None
    return _clamp100(a * 100.0 if a <= 1 else a)


def compose_risk(
    *,
    anomaly_score: Any = None,
    trust_score: Any = None,
    criticality: Any = "",
    exposed_count: Any = 0,
    hop_count: Any = 0,
    evidence: Any = None,
) -> dict:
    behavioral = behavioral_component(evidence, anomaly_score) or 0
    graph = graph_component(anomaly_score) or 0
    trust = _clamp100(trust_score)
    crit = criticality_component(criticality)
    trust_risk = 50 if trust is None else max(0, 100 - trust)
    overall = _clamp100(0.3 * behavioral + 0.3 * graph + 0.2 * trust_risk + 0.2 * crit) or 0
    return {
        "overall": overall,
        "behavioral": behavioral,
        "graph": graph,
        "trust": trust,
        "criticality": crit,
    }


def knowledge_status_from_retrieval(*, chunk_count: int = 0, retrieval_status: str = "") -> str:
    n = int(chunk_count or 0)
    st = str(retrieval_status or "").lower()
    if n > 0 and st in ("success", "partial"):
        return "degraded" if st == "partial" else "success"
    if st == "unavailable" or n == 0:
        return "unavailable"
    return "degraded"
