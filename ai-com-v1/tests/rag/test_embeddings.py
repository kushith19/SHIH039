import pytest
from src.rag.embeddings.local_provider import LocalEmbeddingProvider

@pytest.fixture(scope="module")
def provider():
    # Use the tiny model for tests if you want it faster, but all-MiniLM-L6-v2 is fine
    return LocalEmbeddingProvider(model_name="sentence-transformers/all-MiniLM-L6-v2")

def test_embedding_dimension(provider):
    assert provider.get_dimension() == 384

def test_deterministic_embeddings(provider):
    text1 = "This is a deterministic test."
    text2 = "This is a deterministic test."
    
    emb1 = provider.embed_texts([text1])[0]
    emb2 = provider.embed_texts([text2])[0]
    
    # Check they are identical
    for v1, v2 in zip(emb1, emb2):
        assert abs(v1 - v2) < 1e-6

def test_batch_embeddings(provider):
    texts = ["First document", "Second document", "Third document"]
    embeddings = provider.embed_texts(texts)
    
    assert len(embeddings) == 3
    for emb in embeddings:
        assert len(emb) == 384
