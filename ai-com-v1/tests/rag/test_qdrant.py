import pytest
from src.rag.vectorstore.qdrant_store import QdrantStore
from src.rag.models.document import DocumentChunk, DocumentMetadata

@pytest.fixture
def mock_qdrant():
    # Use :memory: location to avoid needing Docker for tests
    return QdrantStore(
        url="", 
        collection_name="test_collection", 
        dimension=3,
        location=":memory:"
    )

def test_collection_creation(mock_qdrant):
    collections = mock_qdrant.client.get_collections().collections
    assert any(c.name == "test_collection" for c in collections)

def test_upsert_and_retrieve(mock_qdrant):
    metadata = DocumentMetadata(
        category="test_category",
        source="test_source",
        document_name="test_doc",
        document_type="pdf",
        document_hash="0000000000000000000000000000000000000000000000000000000000000000",
        extra={"custom_field": "custom_value"}
    )
    
    # Needs a 64 char string for chunk_id since we slice 32 chars for UUID
    chunk_id_str = "1234567890123456789012345678901234567890123456789012345678901234"
    
    chunk = DocumentChunk(
        chunk_id=chunk_id_str,
        text="This is a test chunk.",
        metadata=metadata,
        section="1. Introduction",
        page_number=1
    )
    
    vector = [0.1, 0.2, 0.3]
    
    # Upsert
    mock_qdrant.upsert_chunks([chunk], [vector])
    
    # Retrieve
    # UUID generated from the first 32 chars of chunk_id_str
    point_id = mock_qdrant._generate_uuid(chunk.chunk_id)
    
    points = mock_qdrant.client.retrieve(
        collection_name="test_collection",
        ids=[point_id]
    )
    
    assert len(points) == 1
    point = points[0]
    
    # Check payload
    assert point.payload["text"] == "This is a test chunk."
    assert point.payload["document_hash"] == metadata.document_hash
    assert point.payload["category"] == "test_category"
    assert point.payload["custom_field"] == "custom_value"
    assert point.payload["section"] == "1. Introduction"

def test_idempotent_ingestion(mock_qdrant):
    # Upsert the same chunk twice should not increase point count
    metadata = DocumentMetadata(
        category="test", source="test", document_name="test",
        document_type="json", document_hash="hash"
    )
    chunk = DocumentChunk(
        chunk_id="a"*64,
        text="test",
        metadata=metadata
    )
    vector = [1.0, 0.0, 0.0]
    
    mock_qdrant.upsert_chunks([chunk], [vector])
    count1 = mock_qdrant.client.count(collection_name="test_collection").count
    
    # Upsert again
    mock_qdrant.upsert_chunks([chunk], [vector])
    count2 = mock_qdrant.client.count(collection_name="test_collection").count
    
    assert count1 == count2
    assert count1 == 1
