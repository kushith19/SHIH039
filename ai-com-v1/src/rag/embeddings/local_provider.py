from typing import List
from sentence_transformers import SentenceTransformer
from src.rag.embeddings.provider import EmbeddingProvider

class LocalEmbeddingProvider(EmbeddingProvider):
    """Local embedding provider using sentence-transformers."""
    
    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        self.model_name = model_name
        print(f"Loading local embedding model: {model_name}")
        self.model = SentenceTransformer(model_name)
        
    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        # sentence-transformers returns a numpy array or torch tensor, convert to list of floats
        embeddings = self.model.encode(texts, convert_to_numpy=True)
        return embeddings.tolist()
        
    def get_dimension(self) -> int:
        return self.model.get_embedding_dimension()
