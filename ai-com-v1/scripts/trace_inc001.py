import asyncio
import sys
import os
import time

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.services.commander_service import CommanderService
from src.adapters.detection_adapter import MockDetectionAdapter
from src.config.settings import settings

async def run_trace():
    settings.llm_provider = "groq"
    service = CommanderService()
    adapter = MockDetectionAdapter()
    
    inc = await adapter.get_detection("INC-001")
    
    initial_state = {
        "analysis_mode": "incident",
        "incident_input": inc,
        "llm_call_count": 0,
        "correction_attempts": 0,
        "error": None
    }
    
    t0 = time.time()
    final_state = await service.graph.ainvoke(initial_state)
    t1 = time.time()
    
    print("\n--- EVIDENCE CATS ---")
    evidence = final_state.get('retrieved_evidence', [])
    unique_cats = set(e.category for e in evidence if hasattr(e, 'category'))
    print(f"Unique Categories: {unique_cats}")
    
    print("\n--- INC-001 TRACE ---")
    planner_mode = final_state.get('planner_mode')
    if planner_mode == "deterministic":
        print("generate_retrieval_plan -> BYPASSED")
    else:
        print(f"generate_retrieval_plan -> LLM CALL")
        
    print(f"retrieve_knowledge -> 0 LLM calls (Status: {final_state.get('retrieval_status')})")
    
    if final_state.get('sufficiency_llm_invoked') is False:
        print("assess_evidence_sufficiency -> BYPASSED")
    else:
        print("assess_evidence_sufficiency -> LLM CALL")
        
    print(f"targeted_retrieval -> 0 LLM calls (Used: {final_state.get('targeted_retrieval_used')})")
    
    print("generate_assessment -> LLM CALL #1")
    
    print(f"validate_structured_output -> deterministic (Error: {final_state.get('validation_errors')})")
    print("validate_safety -> deterministic")
    
    if final_state.get('correction_latency_ms', 0) > 0:
        print("correct_assessment -> LLM CALL")
    else:
        print("correct_assessment -> NOT CALLED")
        
    if final_state.get('safety_correction_latency_ms', 0) > 0:
        print("correct_safety -> LLM CALL")
    else:
        print("correct_safety -> NOT CALLED")
        
    print("\n--- METRICS ---")
    print(f"Logical LLM calls: {final_state.get('llm_call_count')}")
    print(f"Provider fallback: {final_state.get('provider_fallback_used', False)}")
    print(f"Assessment latency: {final_state.get('assessment_latency_ms', 0):.2f} ms")
    print(f"Total latency: {(t1-t0)*1000:.2f} ms")

if __name__ == "__main__":
    asyncio.run(run_trace())
