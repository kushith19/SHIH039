from abc import ABC, abstractmethod
from typing import Any
import logging

from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import Runnable
from langchain_ollama import ChatOllama
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI
from src.config.settings import settings

logger = logging.getLogger(__name__)

_JSON_OBJECT_PROVIDERS = frozenset({"groq", "grok", "xai"})

class ProviderFallbackWrapper(Runnable):
    def __init__(self, primary: Runnable, fallback: Runnable, primary_name: str, fallback_name: str):
        self.primary = primary
        self.fallback = fallback
        self.primary_name = primary_name
        self.fallback_name = fallback_name
        
    def invoke(self, input, config=None, **kwargs):
        try:
            logger.info("[LLM] provider=%s", self.primary_name)
            resp = self.primary.invoke(input, config=config, **kwargs)
            if hasattr(resp, "response_metadata"):
                resp.response_metadata["provider"] = self.primary_name
                resp.response_metadata["provider_fallback_used"] = False
            return resp
        except Exception as e:
            logger.error(
                "[LLM] provider=%s_fallback reason=%s detail=%s",
                self.fallback_name,
                type(e).__name__,
                e,
            )
            resp = self.fallback.invoke(input, config=config, **kwargs)
            if hasattr(resp, "response_metadata"):
                resp.response_metadata["provider"] = self.fallback_name
                resp.response_metadata["provider_fallback_used"] = True
                resp.response_metadata["provider_fallback_reason"] = str(e)
            return resp

    async def ainvoke(self, input, config=None, **kwargs):
        try:
            logger.info("[LLM] provider=%s", self.primary_name)
            resp = await self.primary.ainvoke(input, config=config, **kwargs)
            if hasattr(resp, "response_metadata"):
                resp.response_metadata["provider"] = self.primary_name
                resp.response_metadata["provider_fallback_used"] = False
            return resp
        except Exception as e:
            logger.error(
                "[LLM] provider=%s_fallback reason=%s detail=%s",
                self.fallback_name,
                type(e).__name__,
                e,
            )
            resp = await self.fallback.ainvoke(input, config=config, **kwargs)
            if hasattr(resp, "response_metadata"):
                resp.response_metadata["provider"] = self.fallback_name
                resp.response_metadata["provider_fallback_used"] = True
                resp.response_metadata["provider_fallback_reason"] = str(e)
            return resp
            
    def bind(self, **kwargs):
        primary_kwargs = dict(kwargs)
        if "format" in primary_kwargs and primary_kwargs["format"] == "json":
            if self.primary_name in _JSON_OBJECT_PROVIDERS:
                del primary_kwargs["format"]
                primary_kwargs["response_format"] = {"type": "json_object"}
                
        fallback_kwargs = dict(kwargs)
        if "format" in fallback_kwargs and fallback_kwargs["format"] == "json":
            if self.fallback_name in _JSON_OBJECT_PROVIDERS:
                del fallback_kwargs["format"]
                fallback_kwargs["response_format"] = {"type": "json_object"}
                
        return ProviderFallbackWrapper(
            self.primary.bind(**primary_kwargs),
            self.fallback.bind(**fallback_kwargs),
            self.primary_name,
            self.fallback_name
        )

class LLMProvider(ABC):
    @abstractmethod
    def get_model(self) -> Runnable:
        """Returns a configured LangChain ChatModel or Runnable."""
        pass

class OllamaProvider(LLMProvider):
    def __init__(self):
        self.base_url = settings.ollama_base_url
        self.model_name = settings.ollama_model

        if not self.base_url or not self.model_name:
            raise ValueError("Ollama configuration (ollama_model, ollama_base_url) is missing.")

    def get_model(self) -> Runnable:
        logger.debug(f"Initializing OllamaProvider with model: {self.model_name} at {self.base_url}")
        return ChatOllama(
            model=self.model_name,
            base_url=self.base_url,
            temperature=0.0
        )

class GrokProvider(LLMProvider):
    """xAI Grok via OpenAI-compatible Chat Completions API."""

    def __init__(self):
        self.api_key = (settings.xai_api_key or "").strip()
        self.model_name = settings.xai_model or "grok-4.6"
        self.base_url = (settings.xai_base_url or "https://api.x.ai/v1").rstrip("/")

        if not self.api_key:
            raise ValueError("Grok configuration (xai_api_key) is missing.")

    def get_model(self) -> Runnable:
        logger.debug(
            "Initializing GrokProvider with model: %s at %s",
            self.model_name,
            self.base_url,
        )
        grok_model = ChatOpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            model=self.model_name,
            temperature=0.0,
        )

        ollama_provider = OllamaProvider()
        fallback_model = ollama_provider.get_model()

        return ProviderFallbackWrapper(
            primary=grok_model,
            fallback=fallback_model,
            primary_name="grok",
            fallback_name="ollama",
        )

class GroqProvider(LLMProvider):
    def __init__(self):
        self.api_key = settings.groq_api_key
        self.model_name = settings.groq_model
        
        if not self.api_key or not self.model_name:
            raise ValueError("Groq configuration (groq_api_key, groq_model) is missing.")
            
    def get_model(self) -> Runnable:
        logger.debug(f"Initializing GroqProvider with model: {self.model_name}")
        groq_model = ChatGroq(
            api_key=self.api_key,
            model=self.model_name,
            temperature=0.0
        )
        
        # Initialize fallback instance
        ollama_provider = OllamaProvider()
        fallback_model = ollama_provider.get_model()
        
        return ProviderFallbackWrapper(
            primary=groq_model,
            fallback=fallback_model,
            primary_name="groq",
            fallback_name="ollama"
        )

def get_llm_provider() -> LLMProvider:
    """
    Provider selection:
    - grok / xai / auto (default): cloud primary when key set, else Ollama
      * real XAI key → Grok (api.x.ai)
      * gsk_ key (Groq) in XAI_API_KEY or GROQ_API_KEY → Groq
    - ollama: Ollama only
    - groq: Groq primary → Ollama fallback
    """
    provider_name = (settings.llm_provider or "grok").strip().lower()
    xai_key = (settings.xai_api_key or "").strip()
    groq_key = (settings.groq_api_key or "").strip()

    if provider_name in ("grok", "xai", "auto"):
        # Groq keys (gsk_) must not be sent to api.x.ai
        if groq_key or xai_key.startswith("gsk_"):
            if not groq_key and xai_key.startswith("gsk_"):
                settings.groq_api_key = xai_key
            logger.info("[LLM] routing gsk_/GROQ_API_KEY to Groq (not xAI Grok)")
            return GroqProvider()
        if xai_key:
            return GrokProvider()
        logger.info("[LLM] provider=ollama_fallback reason=missing_cloud_api_key")
        return OllamaProvider()
    if provider_name == "ollama":
        return OllamaProvider()
    if provider_name == "groq":
        if not groq_key and xai_key.startswith("gsk_"):
            settings.groq_api_key = xai_key
        return GroqProvider()
    raise ValueError(f"Unsupported LLM_PROVIDER configured: '{provider_name}'")
