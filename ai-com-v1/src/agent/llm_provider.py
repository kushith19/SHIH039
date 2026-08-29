from abc import ABC, abstractmethod
from typing import Any
import logging

from langchain_core.language_models import BaseChatModel
from langchain_core.runnables import Runnable
from langchain_ollama import ChatOllama
from langchain_groq import ChatGroq
from src.config.settings import settings

logger = logging.getLogger(__name__)

class ProviderFallbackWrapper(Runnable):
    def __init__(self, primary: Runnable, fallback: Runnable, primary_name: str, fallback_name: str):
        self.primary = primary
        self.fallback = fallback
        self.primary_name = primary_name
        self.fallback_name = fallback_name
        
    def invoke(self, input, config=None, **kwargs):
        try:
            resp = self.primary.invoke(input, config=config, **kwargs)
            if hasattr(resp, "response_metadata"):
                resp.response_metadata["provider"] = self.primary_name
                resp.response_metadata["provider_fallback_used"] = False
            return resp
        except Exception as e:
            logger.error(f"Provider failure on {self.primary_name}: {e}. Falling back to {self.fallback_name}.")
            resp = self.fallback.invoke(input, config=config, **kwargs)
            if hasattr(resp, "response_metadata"):
                resp.response_metadata["provider"] = self.fallback_name
                resp.response_metadata["provider_fallback_used"] = True
                resp.response_metadata["provider_fallback_reason"] = str(e)
            return resp
            
    def bind(self, **kwargs):
        primary_kwargs = dict(kwargs)
        if "format" in primary_kwargs and primary_kwargs["format"] == "json":
            if self.primary_name == "groq":
                del primary_kwargs["format"]
                primary_kwargs["response_format"] = {"type": "json_object"}
                
        fallback_kwargs = dict(kwargs)
        if "format" in fallback_kwargs and fallback_kwargs["format"] == "json":
            if self.fallback_name == "groq":
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
    provider_name = (settings.llm_provider or "ollama").strip().lower()
    
    if provider_name == "ollama":
        return OllamaProvider()
    elif provider_name == "groq":
        return GroqProvider()
    else:
        raise ValueError(f"Unsupported LLM_PROVIDER configured: '{provider_name}'")
