"""Lifespan warms RAG when enabled; health stays lightweight."""
import os

# Ensure this module's import order is safe even without root conftest.
os.environ.setdefault("AI_COMMANDER_SKIP_RAG_WARMUP", "1")

from fastapi.testclient import TestClient

from src.main import _should_warm_rag, app


def test_application_starts_and_health_check():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "ai-commander"
    assert data["status"] == "healthy"
    assert "env" in data


def test_rag_warmup_honors_skip_env(monkeypatch):
    monkeypatch.setenv("AI_COMMANDER_SKIP_RAG_WARMUP", "1")
    assert _should_warm_rag() is False
    monkeypatch.setenv("AI_COMMANDER_SKIP_RAG_WARMUP", "0")
    assert _should_warm_rag() is True
    monkeypatch.delenv("AI_COMMANDER_SKIP_RAG_WARMUP", raising=False)
    assert _should_warm_rag() is True
