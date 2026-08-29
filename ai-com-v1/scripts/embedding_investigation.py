import asyncio
import time
from collections import Counter
from src.adapters.detection_adapter import MockDetectionAdapter
from src.rag.embeddings.local_provider import LocalEmbeddingProvider

async def investigate_embeddings():
    models_to_test = [
        "sentence-transformers/all-MiniLM-L6-v2",
        "BAAI/bge-small-en-v1.5"
    ]
    
    queries = [
        "behavioral anomaly telecom-network-gateway hospital-api-gateway hospital-emr",
        "behavioral anomaly water-treatment-control water-distribution-management water-quality-monitoring smart-water-meter-gateway",
        "network intrusion traffic-management-controller traffic-sensor-gateway"
    ]
    
    results = {}
    
    for model_name in models_to_test:
        print(f"\n{'='*60}\nINVESTIGATING MODEL: {model_name}\n{'='*60}")
        try:
            t0 = time.perf_counter()
            embedder = LocalEmbeddingProvider(model_name=model_name)
            
            # Dummy embed to ensure it's loaded and measure latency
            t1 = time.perf_counter()
            _ = embedder.embed_texts(["Warmup query"])
            t2 = time.perf_counter()
            
            load_time = t1 - t0
            infer_time = (t2 - t1) * 1000
            
            dim = embedder.get_dimension()
            print(f"Model Load Time: {load_time:.2f}s")
            print(f"Warmup Inference Latency: {infer_time:.2f}ms")
            print(f"Dimensionality: {dim}")
            
            # Test specific queries
            query_latencies = []
            for q in queries:
                qt0 = time.perf_counter()
                _ = embedder.embed_texts([q])
                qt1 = time.perf_counter()
                query_latencies.append((qt1-qt0)*1000)
                
            avg_lat = sum(query_latencies) / len(query_latencies)
            print(f"Average Query Embedding Latency: {avg_lat:.2f}ms")
            
            results[model_name] = {
                "load_time": load_time,
                "warmup_latency": infer_time,
                "dimensionality": dim,
                "avg_query_latency": avg_lat
            }
            
        except Exception as e:
            print(f"Failed to load or test {model_name}: {e}")
            
    print("\n--- COMPARISON SUMMARY ---")
    for m, metrics in results.items():
        print(f"\n{m}:")
        print(f"  Dims: {metrics['dimensionality']}")
        print(f"  Avg Latency: {metrics['avg_query_latency']:.2f}ms")

if __name__ == "__main__":
    asyncio.run(investigate_embeddings())
