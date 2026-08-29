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
    
    incident_id = sys.argv[1] if len(sys.argv) > 1 else "INC-001"
    inc = await adapter.get_detection(incident_id)
    
    is_campaign = incident_id == "INC-006"
    
    if is_campaign:
        from src.models.detection import CampaignInput
        inc_input = CampaignInput(
            campaign_id=incident_id,
            campaign_type="APT",
            confidence=0.8,
            correlations=["cor-1"],
            incidents=[inc]
        )
    else:
        inc_input = inc
    
    initial_state = {
        "analysis_mode": "campaign" if is_campaign else "incident",
        "incident_input": None if is_campaign else inc_input,
        "campaign_input": inc_input if is_campaign else None,
        "llm_call_count": 0,
        "correction_attempts": 0,
        "error": None
    }
    
    t0 = time.time()
    final_state = await service.graph.ainvoke(initial_state)
    t1 = time.time()
    
    print(f"\n--- {incident_id} TRACE ---")
    planner_mode = final_state.get('planner_mode')
    if planner_mode == "deterministic":
        print("generate_retrieval_plan -> BYPASSED")
    else:
        print("generate_retrieval_plan -> LLM CALL")
        
    print(f"retrieve_knowledge -> 0 LLM calls (Status: {final_state.get('retrieval_status')})")
    
    if final_state.get('sufficiency_llm_invoked') is False:
        print("assess_evidence_sufficiency -> BYPASSED")
    else:
        print("assess_evidence_sufficiency -> LLM CALL")
        
    print(f"targeted_retrieval -> 0 LLM calls (Used: {final_state.get('targeted_retrieval_used')})")
    
    print("generate_assessment -> LLM CALL #1")
    
    val_err = final_state.get('validation_errors')
    print(f"validate_structured_output -> deterministic (Error: {val_err})")
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
    print(f"Success: {'commander_response' in final_state and final_state['commander_response'] is not None}")
    
    if 'commander_response' in final_state and final_state['commander_response'] is not None:
        print("\n--- SAFETY CHECK ---")
        recs = final_state['commander_response'].recommendations
        for r in recs:
            print(f"- {r.action}")

if __name__ == "__main__":
    asyncio.run(run_trace())
