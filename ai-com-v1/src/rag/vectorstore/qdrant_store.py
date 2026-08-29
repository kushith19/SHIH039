import uuid
from typing import List, Dict, Any, Optional, Tuple
from qdrant_client import QdrantClient
from qdrant_client.http import models as rest
from src.rag.models.document import DocumentChunk

class QdrantStore:
    def __init__(self, url: str, collection_name: str, dimension: int, location: Optional[str] = None):
        """
        Initializes the Qdrant store.
        If `location` is ':memory:', it will use an in-memory instance for testing, ignoring `url`.
        """
        if location == ":memory:":
            self.client = QdrantClient(location=":memory:")
        else:
            self.client = QdrantClient(url=url)
            
        self.collection_name = collection_name
        self.dimension = dimension
        self._ensure_collection()
        
    def _ensure_collection(self):
        """Creates the collection if it doesn't exist."""
        collections = self.client.get_collections().collections
        exists = any(c.name == self.collection_name for c in collections)
        
        if not exists:
            print(f"Creating Qdrant collection '{self.collection_name}' with dimension {self.dimension}")
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=rest.VectorParams(
                    size=self.dimension,
                    distance=rest.Distance.COSINE
                )
            )
            
    def _generate_uuid(self, chunk_id: str) -> str:
        """Converts the SHA-256 chunk_id into a valid UUID string for Qdrant."""
        # UUID needs 32 hex chars, our chunk_id is 64 chars
        return str(uuid.UUID(hex=chunk_id[:32]))

    def upsert_chunks(self, chunks: List[DocumentChunk], embeddings: List[List[float]]):
        """Upserts document chunks and their embeddings into Qdrant."""
        if len(chunks) != len(embeddings):
            raise ValueError("Number of chunks must match number of embeddings.")
            
        points = []
        for chunk, vector in zip(chunks, embeddings):
            point_id = self._generate_uuid(chunk.chunk_id)
            
            # Construct the payload preserving all metadata
            payload = {
                "chunk_id": chunk.chunk_id,
                "text": chunk.text,
                "section": chunk.section,
                "page_number": chunk.page_number,
                "category": chunk.metadata.category,
                "source": chunk.metadata.source,
                "document_name": chunk.metadata.document_name,
                "document_type": chunk.metadata.document_type,
                "document_hash": chunk.metadata.document_hash,
            }
            # Add all extra metadata (like mitre_id, tactics, etc.)
            payload.update(chunk.metadata.extra)
            
            points.append(
                rest.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload=payload
                )
            )
            
        self.client.upsert(
            collection_name=self.collection_name,
            points=points
        )

    def search(self, vector: List[float], top_k: int = 5, filters: Optional[Dict[str, Any]] = None) -> List[Tuple[Dict[str, Any], float]]:
        """
        Searches the Qdrant collection using the provided vector.
        Returns a list of tuples containing (payload, score).
        """
        query_filter = None
        if filters:
            must_conditions = []
            for key, value in filters.items():
                must_conditions.append(
                    rest.FieldCondition(
                        key=key,
                        match=rest.MatchValue(value=value)
                    )
                )
            if must_conditions:
                query_filter = rest.Filter(must=must_conditions)
                
        search_result = self.client.query_points(
            collection_name=self.collection_name,
            query=vector,
            query_filter=query_filter,
            limit=top_k,
            with_payload=True
        )
        
        return [(hit.payload, hit.score) for hit in search_result.points]
