import pytest
from src.rag.preprocessing.metadata import generate_metadata_from_path

def test_generate_metadata_nist():
    path = "knowledge/ot-ics/NIST.SP.800-82r3.pdf"
    doc_hash = "fakehash123"
    meta = generate_metadata_from_path(path, doc_hash)
    
    assert meta.category == "ot-ics"
    assert meta.source == "NIST"
    assert meta.document_name == "NIST SP 800-82 Rev 3"
    assert meta.document_type == "pdf"
    assert meta.document_hash == "fakehash123"

def test_generate_metadata_india():
    path = "knowledge/india/CIGU-2023-0001.pdf"
    doc_hash = "fakehash456"
    meta = generate_metadata_from_path(path, doc_hash)
    
    assert meta.category == "india"
    assert meta.source == "CERT-In"
    assert meta.document_name == "CIGU-2023-0001"
    assert meta.document_type == "pdf"
    assert meta.document_hash == "fakehash456"
