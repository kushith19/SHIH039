import asyncio
import time
from src.adapters.detection_adapter import MockDetectionAdapter
from src.agent.graph import create_commander_graph
from src.rag.retriever import VectorRetriever
from src.rag.embeddings.local_provider import LocalEmbeddingProvider
from src.rag.vectorstore.qdrant_store import QdrantStore

async def evaluate_incidents():
    print("Initializing Commander Graph...")
    embedder = LocalEmbeddingProvider(model_name="sentence-transformers/all-MiniLM-L6-v2")
    qdrant = QdrantStore(url="http://localhost:6333", collection_name="ai_commander_knowledge_v1", dimension=embedder.get_dimension())
    retriever = VectorRetriever(embedding_provider=embedder, vector_store=qdrant)
    graph = create_commander_graph(retriever)
    adapter = MockDetectionAdapter()
    
    import sys
    incident_ids = sys.argv[1:] if len(sys.argv) > 1 else ["INC-001", "INC-002", "INC-003", "INC-004", "INC-005", "INC-006"]
    
    for inc_id in incident_ids:
        print(f"\n{'='*60}\nEVALUATING INCIDENT: {inc_id}\n{'='*60}")
        detection = await adapter.get_detection(inc_id)
        if not detection:
            print(f"Incident {inc_id} not found!")
            continue
            
        initial_state = {
            "detection_input": detection,
            "raw_llm_output": None,
            "commander_response": None,
            "error": None
        }
        
        t0 = time.perf_counter()
        final_state = await graph.ainvoke(initial_state)
        t1 = time.perf_counter()
        total_lat = (t1-t0)*1000
        
        print("\n--- RETRIEVAL PLAN ---")
        plan = final_state.get("retrieval_plan")
        if plan:
            for q in plan.queries:
                print(f"- {q.query} (Cat: {q.category.value if q.category else 'None'})")
        
        print("\n--- EVIDENCE DETAILS ---")
        ev_list = final_state.get("retrieved_evidence", [])
        print(f"Total chunks returned: {len(ev_list)}")
        for ev in ev_list:
            print(f"  [{ev.score:.2f}] {ev.source} / {ev.document_name} / {ev.category}")
            
        print("\n--- SUFFICIENCY DECISION ---")
        suff_invoked = final_state.get("sufficiency_llm_invoked", True)
        if suff_invoked:
            print("Sufficiency LLM Invoked: True")
            suff = final_state.get("evidence_sufficiency")
            if suff:
                print(f"Sufficient: {suff.sufficient}")
                print(f"Missing Domains: {final_state.get('missing_domains', [])}")
                print(f"Rationale: {suff.rationale}")
        else:
            print("Sufficiency LLM Invoked: False")
            print(f"Bypass Reason: {final_state.get('deterministic_bypass_reason')}")
            
        print("\n--- TARGETED RETRIEVAL ---")
        tgt_used = final_state.get("targeted_retrieval_used", False)
        print(f"Triggered: {tgt_used}")
        if tgt_used:
            print(f"Additional chunks retrieved: {final_state.get('additional_chunks_retrieved', 0)}")
            
        print("\n--- EXECUTION METRICS ---")
        print(f"LLM Calls: {final_state.get('llm_call_count', 0)}")
        print(f"Evidence Context Size: {final_state.get('evidence_context_size', 0)} chars")
        print(f"Final Evidence Count: {final_state.get('final_evidence_count', 0)}")
            
        print("\n--- FINAL RESPONSE ---")
        resp = final_state.get("commander_response")
        if resp:
            print(resp.model_dump_json(indent=2))
        elif final_state.get("error"):
            print(f"ERROR: {final_state['error']}")
            
        print("\n--- LATENCY BREAKDOWN ---")
        print(f"Planning: {final_state.get('planning_latency_ms', 0):.2f}ms")
        print(f"Retrieval: {final_state.get('retrieval_latency_ms', 0):.2f}ms")
        print(f"Sufficiency: {final_state.get('sufficiency_latency_ms', 0):.2f}ms")
        print(f"Targeted Retrieval: {final_state.get('targeted_retrieval_latency_ms', 0):.2f}ms")
        print(f"Assessment: {final_state.get('assessment_latency_ms', 0):.2f}ms")
        if final_state.get("correction_attempts", 0) > 0:
            print(f"Correction: {final_state.get('correction_latency_ms', 0):.2f}ms")
        print(f"TOTAL: {total_lat:.2f}ms\n")

if __name__ == "__main__":
    asyncio.run(evaluate_incidents())
