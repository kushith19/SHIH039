import os
import json
import time
import argparse
from typing import List
from src.config.settings import settings
from src.rag.models.document import DocumentChunk, DocumentMetadata
from src.rag.embeddings.local_provider import LocalEmbeddingProvider
from src.rag.vectorstore.qdrant_store import QdrantStore

def load_chunks(input_dir: str) -> List[DocumentChunk]:
    """Loads all processed JSON chunks from a directory."""
    chunks = []
    if not os.path.exists(input_dir):
        return chunks
        
    for f in os.listdir(input_dir):
        if f.endswith(".json"):
            path = os.path.join(input_dir, f)
            with open(path, 'r', encoding='utf-8') as file:
                data = json.load(file)
                for item in data:
                    chunks.append(DocumentChunk(**item))
    return chunks

def run_ingestion(input_dir: str, batch_size: int = 256):
    print("--- Phase 4B-1 Qdrant Ingestion ---")
    start_time = time.time()
    
    # 1. Load data
    print(f"Loading chunks from {input_dir}...")
    chunks = load_chunks(input_dir)
    if not chunks:
        print("No chunks found. Aborting.")
        return
        
    # Find unique documents for stats
    unique_docs = set(c.metadata.document_hash for c in chunks)
    print(f"Loaded {len(chunks)} chunks from {len(unique_docs)} documents.")
    
    # 2. Load configured embedding model
    print(f"Initializing embedding provider: {settings.embedding_model}")
    embed_provider = LocalEmbeddingProvider(model_name=settings.embedding_model)
    dimension = embed_provider.get_dimension()
    
    # 3. Verify / Init Qdrant
    print(f"Initializing Qdrant client at {settings.qdrant_url}, collection '{settings.qdrant_collection}'...")
    qdrant = QdrantStore(
        url=settings.qdrant_url,
        collection_name=settings.qdrant_collection,
        dimension=dimension
    )
    
    # 4. Process in batches
    print(f"Starting ingestion with batch size {batch_size}...")
    total_chunks = len(chunks)
    embedded_count = 0
    uploaded_count = 0
    
    for i in range(0, total_chunks, batch_size):
        batch = chunks[i:i+batch_size]
        texts = [c.text for c in batch]
        
        # Generate embeddings
        embeddings = embed_provider.embed_texts(texts)
        embedded_count += len(embeddings)
        
        # Upsert into Qdrant
        qdrant.upsert_chunks(batch, embeddings)
        uploaded_count += len(batch)
        
        print(f"Progress: {uploaded_count}/{total_chunks} chunks ingested...")
        
    elapsed = time.time() - start_time
    
    print("\n--- Ingestion Statistics ---")
    print(f"Documents: {len(unique_docs)}")
    print(f"Chunks: {total_chunks}")
    print(f"Embedded: {embedded_count}")
    print(f"Uploaded: {uploaded_count}")
    print(f"Collection: {settings.qdrant_collection}")
    print(f"Dimension: {dimension}")
    print(f"Elapsed: {elapsed:.2f} seconds")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="data/processed", help="Directory containing processed chunks")
    parser.add_argument("--batch-size", type=int, default=256, help="Batch size for embeddings and upserts")
    args = parser.parse_args()
    
    run_ingestion(args.input, args.batch_size)
