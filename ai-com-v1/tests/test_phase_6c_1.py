import pytest
from unittest.mock import patch, MagicMock
from langchain_core.messages import HumanMessage

from src.agent.llm_provider import get_llm_provider, GroqProvider, OllamaProvider, ProviderFallbackWrapper
from src.config.settings import settings

def test_factory_selects_groq(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "test_key")
    monkeypatch.setattr(settings, "groq_model", "test_model")
    
    provider = get_llm_provider()
    assert isinstance(provider, GroqProvider)
    
    # Check that getting model returns the wrapper
    model = provider.get_model()
    assert isinstance(model, ProviderFallbackWrapper)
    assert model.primary_name == "groq"
    assert model.fallback_name == "ollama"

def test_factory_selects_ollama(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "ollama")
    monkeypatch.setattr(settings, "ollama_base_url", "http://test")
    monkeypatch.setattr(settings, "ollama_model", "test_model")
    
    provider = get_llm_provider()
    assert isinstance(provider, OllamaProvider)
    
    model = provider.get_model()
    from langchain_ollama import ChatOllama
    assert isinstance(model, ChatOllama)

def test_factory_unsupported_provider(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "invalid_provider")
    with pytest.raises(ValueError, match="Unsupported LLM_PROVIDER"):
        get_llm_provider()

def test_groq_missing_config_fails(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "groq")
    monkeypatch.setattr(settings, "groq_api_key", "")
    with pytest.raises(ValueError, match="Groq configuration"):
        get_llm_provider()

def test_provider_fallback_wrapper_success():
    primary = MagicMock()
    primary_resp = MagicMock()
    primary_resp.response_metadata = {}
    primary.invoke.return_value = primary_resp
    
    fallback = MagicMock()
    
    wrapper = ProviderFallbackWrapper(primary, fallback, "primary", "fallback")
    res = wrapper.invoke([HumanMessage(content="test")])
    
    assert res == primary_resp
    assert res.response_metadata["provider"] == "primary"
    assert res.response_metadata["provider_fallback_used"] is False
    assert fallback.invoke.call_count == 0

def test_provider_fallback_wrapper_failure():
    primary = MagicMock()
    primary.invoke.side_effect = Exception("API connection error")
    
    fallback = MagicMock()
    fallback_resp = MagicMock()
    fallback_resp.response_metadata = {}
    fallback.invoke.return_value = fallback_resp
    
    wrapper = ProviderFallbackWrapper(primary, fallback, "primary", "fallback")
    res = wrapper.invoke([HumanMessage(content="test")])
    
    assert res == fallback_resp
    assert res.response_metadata["provider"] == "fallback"
    assert res.response_metadata["provider_fallback_used"] is True
    assert res.response_metadata["provider_fallback_reason"] == "API connection error"
    assert fallback.invoke.call_count == 1

def test_provider_fallback_wrapper_bind_format():
    primary = MagicMock()
    fallback = MagicMock()
    
    wrapper = ProviderFallbackWrapper(primary, fallback, "groq", "ollama")
    
    # Simulate calling bind with format="json" (as done in graph.py for structured output)
    wrapper.bind(format="json")
    
    # Primary should be bound with response_format
    primary.bind.assert_called_with(response_format={"type": "json_object"})
    # Fallback (ollama) should be bound with format="json"
    fallback.bind.assert_called_with(format="json")
