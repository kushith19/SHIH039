import os

# Avoid loading SentenceTransformer during unit TestClient lifespan.
os.environ.setdefault("AI_COMMANDER_SKIP_RAG_WARMUP", "1")
