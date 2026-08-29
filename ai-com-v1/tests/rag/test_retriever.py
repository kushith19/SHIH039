import pytest
from src.rag.retriever import VectorRetriever
from src.rag.vectorstore.qdrant_store import QdrantStore
from src.rag.embeddings.local_provider import LocalEmbeddingProvider
from src.rag.models.document import DocumentChunk, DocumentMetadata

@pytest.fixture
def mock_retriever():
    embed = LocalEmbeddingProvider(model_name="sentence-transformers/all-MiniLM-L6-v2")
    # using :memory: qdrant for tests
    qdrant = QdrantStore(url="", collection_name="test_collection", dimension=384, location=":memory:")
    
    # insert some test chunks
    chunks = [
        DocumentChunk(
            chunk_id="a"*64,
            text="The smart city traffic light system was compromised via an unpatched vulnerability.",
            metadata=DocumentMetadata(category="smart-city", source="NIST", document_name="doc1", document_type="pdf", document_hash="hash1")
        ),
        DocumentChunk(
            chunk_id="b"*64,
            text="IoT device default passwords are a major risk for unauthorized access.",
            metadata=DocumentMetadata(category="iot", source="ETSI", document_name="doc2", document_type="pdf", document_hash="hash2")
        ),
        DocumentChunk(
            chunk_id="c"*64,
            text="Incident response requires preparation, detection, containment, and recovery.",
            metadata=DocumentMetadata(category="incident-response", source="CISA", document_name="doc3", document_type="pdf", document_hash="hash3")
        )
    ]
    
    embeddings = embed.embed_texts([c.text for c in chunks])
    qdrant.upsert_chunks(chunks, embeddings)
    
    return VectorRetriever(embedding_provider=embed, vector_store=qdrant)

def test_basic_retrieval(mock_retriever):
    result = mock_retriever.retrieve("How to respond to an incident?", top_k=2)
    assert len(result.results) == 2
    # The first result should be the incident response one
    assert result.results[0].category == "incident-response"
    assert result.results[0].rank == 1
    
    assert result.embedding_latency_ms > 0
    assert result.search_latency_ms > 0
    assert result.total_latency_ms > 0

def test_filtering(mock_retriever):
    # Query for "smart city" but filter to "iot"
    result = mock_retriever.retrieve("smart city", top_k=2, filters={"category": "iot"})
    assert len(result.results) == 1
    assert result.results[0].category == "iot"
    
def test_deterministic_retrieval(mock_retriever):
    result1 = mock_retriever.retrieve("traffic light", top_k=1)
    result2 = mock_retriever.retrieve("traffic light", top_k=1)
    
    assert result1.results[0].chunk_id == result2.results[0].chunk_id
    assert result1.results[0].score == result2.results[0].score

def test_empty_results(mock_retriever):
    result = mock_retriever.retrieve("random", top_k=5, filters={"category": "nonexistent"})
    assert len(result.results) == 0

def test_invalid_query(mock_retriever):
    # Emtpy query might behave weirdly depending on embedder, but should return results
    result = mock_retriever.retrieve("", top_k=1)
    assert len(result.results) == 1
