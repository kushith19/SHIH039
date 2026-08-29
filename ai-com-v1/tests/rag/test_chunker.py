import pytest
from src.rag.preprocessing.chunker import chunk_blocks
from src.rag.models.document import DocumentMetadata

def test_chunker():
    metadata = DocumentMetadata(
        category="test", source="test", document_name="test",
        document_type="pdf", document_hash="testhash123", extra={}
    )
    
    blocks = [
        {"text": "1. Introduction", "is_heading": True, "page_number": 1},
        {"text": "This is paragraph 1.", "is_heading": False, "page_number": 1},
        {"text": "This is paragraph 2.", "is_heading": False, "page_number": 1},
        {"text": "2. Background", "is_heading": True, "page_number": 2},
        {"text": "This is paragraph 3.", "is_heading": False, "page_number": 2},
    ]
    
    chunks = chunk_blocks(blocks, metadata, max_chunk_size=100)
    
    assert len(chunks) == 2
    assert chunks[0].section == "1. Introduction"
    assert "paragraph 1" in chunks[0].text
    assert chunks[1].section == "2. Background"
    assert "paragraph 3" in chunks[1].text
    
    # Check deterministic chunk ID
    chunks2 = chunk_blocks(blocks, metadata, max_chunk_size=100)
    assert chunks[0].chunk_id == chunks2[0].chunk_id
