import os
import json
from datetime import datetime
from src.config.settings import settings
from src.rag.embeddings.local_provider import LocalEmbeddingProvider
from src.rag.vectorstore.qdrant_store import QdrantStore
from src.rag.retriever import VectorRetriever

EVALUATION_QUERIES = [
    {
        "id": "1",
        "query": "What cybersecurity considerations apply to interconnected smart-city infrastructure?",
        "expected_categories": ["smart-city"],
        "expected_sources": []
    },
    {
        "id": "2",
        "query": "What security capabilities should an IoT device have to protect against unauthorized access?",
        "expected_categories": ["iot"],
        "expected_sources": []
    },
    {
        "id": "3",
        "query": "What should be considered when responding to a cybersecurity incident affecting an industrial control system?",
        "expected_categories": ["ot-ics", "incident-response"],
        "expected_sources": []
    },
    {
        "id": "4",
        "query": "What are the appropriate stages for containing and recovering from a cybersecurity incident?",
        "expected_categories": ["incident-response"],
        "expected_sources": []
    },
    {
        "id": "5",
        "query": "What cybersecurity practices are relevant to smart-city infrastructure in India?",
        "expected_categories": ["india", "smart-city"],
        "expected_sources": ["BIS", "CERT-In"]
    },
    {
        "id": "6",
        "query": "What ATT&CK for ICS techniques are associated with unauthorized access or network-based attacks?",
        "expected_categories": ["attack-intelligence"],
        "expected_sources": ["MITRE"]
    },
    {
        "id": "7",
        "query": "A smart-city water treatment control system shows abnormal outbound network traffic and elevated workload. What security considerations should be investigated?",
        "expected_categories": ["smart-city", "ot-ics", "incident-response"],
        "expected_sources": []
    },
    {
        "id": "8",
        "query": "A hospital infrastructure endpoint shows suspicious outbound traffic and degraded operational status. What incident-response and IoT/OT security guidance may be relevant?",
        "expected_categories": ["iot", "ot-ics", "incident-response"],
        "expected_sources": []
    }
]

def main():
    print("--- Phase 4B-2 RAG Evaluation ---")
    
    embed_provider = LocalEmbeddingProvider(model_name=settings.embedding_model)
    qdrant = QdrantStore(
        url=settings.qdrant_url,
        collection_name=settings.qdrant_collection,
        dimension=embed_provider.get_dimension()
    )
    retriever = VectorRetriever(embedding_provider=embed_provider, vector_store=qdrant)
    
    results_report = {
        "timestamp": datetime.utcnow().isoformat(),
        "model": settings.embedding_model,
        "evaluations": []
    }
    
    for case in EVALUATION_QUERIES:
        print(f"\n==================================================")
        print(f"Eval Case {case['id']}: {case['query']}")
        print(f"==================================================")
        
        result = retriever.retrieve(case["query"], top_k=5)
        
        case_report = {
            "id": case["id"],
            "query": case["query"],
            "expected_categories": case["expected_categories"],
            "expected_sources": case["expected_sources"],
            "embedding_latency_ms": result.embedding_latency_ms,
            "search_latency_ms": result.search_latency_ms,
            "total_latency_ms": result.total_latency_ms,
            "results": []
        }
        
        for chunk in result.results:
            text_preview = chunk.text[:150].replace('\n', ' ') + "..." if len(chunk.text) > 150 else chunk.text.replace('\n', ' ')
            print(f"[{chunk.rank}] score={chunk.score:.4f} | cat={chunk.category} | src={chunk.source}")
            print(f"    Doc: {chunk.document_name} | Sec: {chunk.section} | Pg: {chunk.page_number}")
            print(f"    Text: {text_preview}")
            print()
            
            case_report["results"].append({
                "rank": chunk.rank,
                "score": chunk.score,
                "category": chunk.category,
                "source": chunk.source,
                "document_name": chunk.document_name,
                "section": chunk.section,
                "page_number": chunk.page_number,
                "text": chunk.text,
                "chunk_id": chunk.chunk_id
            })
            
        print(f"Latency: Embed {result.embedding_latency_ms:.1f}ms | Search {result.search_latency_ms:.1f}ms | Total {result.total_latency_ms:.1f}ms")
        
        results_report["evaluations"].append(case_report)
        
    # Save the report
    os.makedirs("data/evaluation", exist_ok=True)
    report_path = "data/evaluation/retrieval_results.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(results_report, f, indent=2)
        
    print(f"\nEvaluation complete. Report saved to {report_path}")

if __name__ == "__main__":
    main()
