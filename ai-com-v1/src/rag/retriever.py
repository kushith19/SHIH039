import time
from typing import Dict, Any, Optional
from src.rag.embeddings.provider import EmbeddingProvider
from src.rag.vectorstore.qdrant_store import QdrantStore
from src.rag.models.document import RetrievedChunk, RetrievalResult, DocumentMetadata

class VectorRetriever:
    """Retrieval abstraction decoupling LangGraph/Commander from the underlying vector store."""
    
    def __init__(self, embedding_provider: EmbeddingProvider, vector_store: QdrantStore):
        self.embedding_provider = embedding_provider
        self.vector_store = vector_store
        
    def retrieve(self, query: str, top_k: int = 5, filters: Optional[Dict[str, Any]] = None) -> RetrievalResult:
        """
        Retrieves the most semantically relevant chunks for a given query.
        """
        t0 = time.perf_counter()
        
        # 1. Embed query
        query_vector = self.embedding_provider.embed_texts([query])[0]
        
        t1 = time.perf_counter()
        
        # 2. Search vector store
        search_results = self.vector_store.search(
            vector=query_vector,
            top_k=top_k,
            filters=filters
        )
        
        t2 = time.perf_counter()
        
        # 3. Map payloads to RetrievedChunk objects
        retrieved_chunks = []
        for rank, (payload, score) in enumerate(search_results, start=1):
            # Extract basic metadata properties from payload
            metadata_dict = {
                "category": payload.get("category", ""),
                "source": payload.get("source", ""),
                "document_name": payload.get("document_name", ""),
                "document_type": payload.get("document_type", ""),
                "document_hash": payload.get("document_hash", ""),
            }
            
            # Reconstruct extra dict (everything not in the standard list)
            standard_keys = {"chunk_id", "text", "section", "page_number", "category", "source", "document_name", "document_type", "document_hash"}
            extra_dict = {k: v for k, v in payload.items() if k not in standard_keys}
            metadata_dict["extra"] = extra_dict
            
            meta = DocumentMetadata(**metadata_dict)
            
            chunk = RetrievedChunk(
                chunk_id=payload["chunk_id"],
                text=payload["text"],
                score=score,
                rank=rank,
                source=payload.get("source", ""),
                document_name=payload.get("document_name", ""),
                category=payload.get("category", ""),
                section=payload.get("section"),
                page_number=payload.get("page_number"),
                metadata=meta
            )
            retrieved_chunks.append(chunk)
            
        embedding_ms = (t1 - t0) * 1000
        search_ms = (t2 - t1) * 1000
        total_ms = (t2 - t0) * 1000
        
        return RetrievalResult(
            results=retrieved_chunks,
            embedding_latency_ms=embedding_ms,
            search_latency_ms=search_ms,
            total_latency_ms=total_ms
        )
