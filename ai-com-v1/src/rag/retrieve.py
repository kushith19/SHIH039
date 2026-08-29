import argparse
from src.config.settings import settings
from src.rag.embeddings.local_provider import LocalEmbeddingProvider
from src.rag.vectorstore.qdrant_store import QdrantStore
from src.rag.retriever import VectorRetriever

def main():
    parser = argparse.ArgumentParser(description="Ad-hoc CLI Retriever")
    parser.add_argument("query", type=str, help="The query string to retrieve chunks for")
    parser.add_argument("--top-k", type=int, default=5, help="Number of chunks to retrieve")
    parser.add_argument("--category", type=str, help="Optional category filter")
    parser.add_argument("--source", type=str, help="Optional source filter")
    args = parser.parse_args()
    
    print(f"Initializing embedding provider: {settings.embedding_model}")
    embed_provider = LocalEmbeddingProvider(model_name=settings.embedding_model)
    
    print(f"Initializing Qdrant client at {settings.qdrant_url} (collection: {settings.qdrant_collection})")
    qdrant = QdrantStore(
        url=settings.qdrant_url,
        collection_name=settings.qdrant_collection,
        dimension=embed_provider.get_dimension()
    )
    
    retriever = VectorRetriever(embedding_provider=embed_provider, vector_store=qdrant)
    
    filters = {}
    if args.category:
        filters["category"] = args.category
    if args.source:
        filters["source"] = args.source
        
    print(f"\nQuery: '{args.query}'")
    if filters:
        print(f"Filters: {filters}")
        
    print("-" * 50)
    
    result = retriever.retrieve(args.query, top_k=args.top_k, filters=filters if filters else None)
    
    for chunk in result.results:
        print(f"[{chunk.rank}] score={chunk.score:.4f}")
        print(f"Source: {chunk.source}")
        print(f"Document: {chunk.document_name}")
        print(f"Category: {chunk.category}")
        print(f"Section: {chunk.section}")
        print(f"Page: {chunk.page_number}")
        print("Text:")
        print(chunk.text[:500] + "..." if len(chunk.text) > 500 else chunk.text)
        print("-" * 50)
        
    print(f"\nEmbedding latency: {result.embedding_latency_ms:.2f} ms")
    print(f"Search latency:    {result.search_latency_ms:.2f} ms")
    print(f"Total latency:     {result.total_latency_ms:.2f} ms")

if __name__ == "__main__":
    main()
