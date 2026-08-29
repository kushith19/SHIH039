import asyncio
import time
from collections import Counter
from src.adapters.detection_adapter import MockDetectionAdapter
from src.rag.retriever import VectorRetriever
from src.rag.embeddings.local_provider import LocalEmbeddingProvider
from src.rag.vectorstore.qdrant_store import QdrantStore

async def run_diagnostic():
    print("Initializing Diagnostic Retriever...")
    embedder = LocalEmbeddingProvider(model_name="sentence-transformers/all-MiniLM-L6-v2")
    qdrant = QdrantStore(url="http://localhost:6333", collection_name="ai_commander_knowledge_v1", dimension=embedder.get_dimension())
    retriever = VectorRetriever(embedding_provider=embedder, vector_store=qdrant)
    adapter = MockDetectionAdapter()
    
    incident_ids = ["INC-001", "INC-002", "INC-003", "INC-004", "INC-005", "INC-006"]
    
    for inc_id in incident_ids:
        print(f"\n{'='*60}\nDIAGNOSTIC: {inc_id}\n{'='*60}")
        detection = await adapter.get_detection(inc_id)
        if not detection:
            print(f"Incident {inc_id} not found!")
            continue
            
        # Formulate a basic deterministic query based on detection properties
        query = str(detection.detection_type.value).replace('_', ' ')
        if detection.affected_endpoints:
            query += f" {' '.join(detection.affected_endpoints)}"
        
        print(f"Query: '{query}'")
        
        # Retrieve top 10 to inspect deep diversity
        t0 = time.perf_counter()
        result = retriever.retrieve(query, top_k=10)
        t1 = time.perf_counter()
        
        chunks = result.results
        if not chunks:
            print("No chunks retrieved.")
            continue
            
        scores = [c.score for c in chunks]
        print(f"Top-K Scores: {[f'{s:.3f}' for s in scores]}")
        print(f"Top Document: {chunks[0].document_name}")
        print(f"Top Category: {chunks[0].category}")
        
        doc_counts = Counter(c.document_name for c in chunks)
        cat_counts = Counter(c.category for c in chunks)
        
        print(f"\nDocument Diversity ({len(doc_counts)} unique docs):")
        for doc, count in doc_counts.most_common():
            print(f"  - {doc}: {count} chunks")
            
        print(f"\nCategory Diversity ({len(cat_counts)} unique cats):")
        for cat, count in cat_counts.most_common():
            print(f"  - {cat}: {count} chunks")
            
        print(f"\nDuplicate/Near-duplicate Results Analysis:")
        # Simple heuristic: exact same document and section, or very similar score
        seen_texts = set()
        duplicates = 0
        for i, c in enumerate(chunks):
            # very crude proxy for duplicate string
            text_prefix = c.text[:100]
            if text_prefix in seen_texts:
                print(f"  - Possible duplicate at rank {i+1} (Doc: {c.document_name}, Score: {c.score:.3f})")
                duplicates += 1
            seen_texts.add(text_prefix)
            
        if duplicates == 0:
            print("  - No obvious exact prefix duplicates found.")
            
        print(f"\nRelevant-Looking Results (Top 5):")
        for c in chunks[:5]:
            print(f"  [{c.score:.3f}] {c.document_name} | {c.category} | {c.section or 'No section'}")

if __name__ == "__main__":
    asyncio.run(run_diagnostic())
