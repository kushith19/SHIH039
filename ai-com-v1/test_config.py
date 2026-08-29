from src.config.settings import settings
print(f"Provider: {settings.llm_provider}")
print(f"Model: {settings.groq_model}")
print(f"Key configured: {'yes' if settings.groq_api_key else 'no'}")
print(f"Ollama URL: {settings.ollama_base_url}")
