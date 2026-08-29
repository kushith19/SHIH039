from abc import ABC, abstractmethod
from typing import List

class EmbeddingProvider(ABC):
    """Abstract base class for embedding providers."""
    
    @abstractmethod
    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        """Generates embeddings for a list of texts."""
        pass
        
    @abstractmethod
    def get_dimension(self) -> int:
        """Returns the dimension of the embeddings produced by this provider."""
        pass
