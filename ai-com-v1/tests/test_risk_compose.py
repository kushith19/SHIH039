from src.agent.risk_compose import compose_risk, knowledge_status_from_retrieval


def test_compose_risk_from_observed():
    risk = compose_risk(
        anomaly_score=0.82,
        trust_score=31,
        criticality="critical",
        exposed_count=3,
        hop_count=2,
        evidence=[{"deviationPct": 81}],
    )
    assert risk["behavioral"] == 81
    assert risk["graph"] == 82
    assert risk["trust"] == 31
    assert risk["criticality"] == 95


def test_knowledge_empty_is_unavailable():
    assert knowledge_status_from_retrieval(chunk_count=0, retrieval_status="unavailable") == "unavailable"
