import asyncio
import sys
import os
import time
from datetime import datetime, timezone

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.models.detection import DetectionInput, DetectionType, Severity, CampaignInput
from src.services.commander_service import CommanderService
from src.config.settings import settings

now = datetime.now(timezone.utc)

# --- LAYER B: LIVE TEST CASES ---

LIVE_CASES = {
    "INC-ADV-A1": DetectionInput(
        incidentId="INC-ADV-A1", timestamp=now, detectionType=DetectionType.behavioral_anomaly, severity=Severity.high,
        confidence=0.9, riskScore=0.9, affectedEndpoints=["ep1", "ep2", "ep3"],
        metadata={"description": "Normal behavioral anomaly"}, evidence=[{"type": "log", "details": "anomaly"}]
    ),
    "INC-ADV-B1": DetectionInput(
        incidentId="INC-ADV-B1", timestamp=now, detectionType=DetectionType.network_intrusion, severity=Severity.high,
        confidence=0.8, riskScore=0.8, affectedEndpoints=["ep1"],
        metadata={"description": "Abnormal traffic detected."}, evidence=[{"type": "net", "details": "anomaly"}]
    ),
    "INC-ADV-C1": DetectionInput(
        incidentId="INC-ADV-C1", timestamp=now, detectionType=DetectionType.behavioral_anomaly, severity=Severity.critical,
        confidence=0.9, riskScore=0.9, affectedEndpoints=["water-treatment-control"],
        metadata={"description": "OT anomaly"}, evidence=[{"type": "net", "details": "abnormal outbound traffic"}]
    ),
    "INC-ADV-D2": DetectionInput(
        incidentId="INC-ADV-D2", timestamp=now, detectionType=DetectionType.behavioral_anomaly, severity=Severity.high,
        confidence=0.9, riskScore=0.9, affectedEndpoints=["auth-server"],
        metadata={"description": "Possible credential access"}, evidence=[{"type": "auth", "details": "behavioral patterns consistent with credential dumping but no direct proof"}]
    ),
    "INC-ADV-E1": DetectionInput(
        incidentId="INC-ADV-E1", timestamp=now, detectionType=DetectionType.behavioral_anomaly, severity=Severity.high,
        confidence=0.9, riskScore=0.9, affectedEndpoints=["hospital-emr", "telecom-gateway"],
        metadata={"description": "Cross domain anomaly"}, evidence=[{"type": "log", "details": "cross sector activity"}]
    ),
    "CAMP-ADV-F2": CampaignInput(
        campaign_id="CAMP-ADV-F2", campaign_type="APT", confidence=0.8, correlations=["c1"],
        incidents=[
            DetectionInput(incidentId="c1", timestamp=now, detectionType=DetectionType.behavioral_anomaly, severity=Severity.high, confidence=0.9, riskScore=0.9, affectedEndpoints=["water-pump"], metadata={}, evidence=[]),
            DetectionInput(incidentId="c2", timestamp=now, detectionType=DetectionType.behavioral_anomaly, severity=Severity.high, confidence=0.9, riskScore=0.9, affectedEndpoints=["telecom-router"], metadata={}, evidence=[]),
            DetectionInput(incidentId="c3", timestamp=now, detectionType=DetectionType.behavioral_anomaly, severity=Severity.high, confidence=0.9, riskScore=0.9, affectedEndpoints=["gov-server"], metadata={}, evidence=[])
        ]
    ),
    "INC-ADV-H1": DetectionInput(
        incidentId="INC-ADV-H1", timestamp=now, detectionType=DetectionType.behavioral_anomaly, severity=Severity.high,
        confidence=0.9, riskScore=0.9, affectedEndpoints=["unknown-device"],
        metadata={"description": "completely unrelated to anything known"}, evidence=[{"type": "alien", "details": "extraterrestrial signal"}]
    )
}

# --- LAYER A: DETERMINISTIC TESTS ---

def run_layer_a():
    print("=== LAYER A: DETERMINISTIC / LOCAL TESTS ===")
    passed = 0
    failed = 0
    
    # 1. Validation Malformed Input
    try:
        # Invalid confidence
        DetectionInput(incidentId="I1", timestamp=now, detectionType=DetectionType.behavioral_anomaly, severity=Severity.high, confidence=1.5, riskScore=0.9, affectedEndpoints=["ep1"], evidence=[])
        print("FAIL: Validation allowed confidence > 1")
        failed += 1
    except Exception as e:
        passed += 1
        
    # 2. Duplicate handling (Campaign)
    try:
        inc = DetectionInput(incidentId="I1", timestamp=now, detectionType=DetectionType.behavioral_anomaly, severity=Severity.high, confidence=0.9, riskScore=0.9, affectedEndpoints=["ep1"], evidence=[])
        CampaignInput(campaign_id="C1", campaign_type="APT", confidence=0.8, correlations=[], incidents=[inc, inc])
        passed += 1 # Technically pydantic doesn't block duplicates unless set, but we test if it parses.
    except Exception as e:
        failed += 1
        
    # 3. Routing (Test complexity logic)
    from src.agent.graph import get_incident_summary
    
    # Simple
    state_simple = {"analysis_mode": "incident", "incident_input": LIVE_CASES["INC-ADV-A1"]}
    desc, base, ep, is_complex, has_ot, has_it = get_incident_summary(state_simple)
    if not is_complex: passed += 1
    else: failed += 1
    
    # Complex (4+ endpoints)
    state_complex = {"analysis_mode": "incident", "incident_input": DetectionInput(incidentId="C4", timestamp=now, detectionType=DetectionType.behavioral_anomaly, severity=Severity.high, confidence=0.9, riskScore=0.9, affectedEndpoints=["e1", "e2", "e3", "e4"], evidence=[])}
    desc, base, ep, is_complex, has_ot, has_it = get_incident_summary(state_complex)
    if is_complex: passed += 1
    else: failed += 1
    
    print(f"Layer A Total: {passed+failed}, Passed: {passed}, Failed: {failed}\n")

# --- LAYER B: LIVE EVALUATION ---

async def run_layer_b():
    print("=== LAYER B: LIMITED LIVE GROQ TESTS ===")
    settings.llm_provider = "groq"
    service = CommanderService()
    
    for case_id, case_input in LIVE_CASES.items():
        is_campaign = isinstance(case_input, CampaignInput)
        print(f"\n--- Running {case_id} ---")
        
        initial_state = {
            "analysis_mode": "campaign" if is_campaign else "incident",
            "incident_input": None if is_campaign else case_input,
            "campaign_input": case_input if is_campaign else None,
            "llm_call_count": 0,
            "correction_attempts": 0,
            "error": None
        }
        
        t0 = time.time()
        try:
            final_state = await service.graph.ainvoke(initial_state)
            t1 = time.time()
            
            print("TRACE:")
            pmode = final_state.get('planner_mode')
            print(f"generate_retrieval_plan -> {'BYPASSED' if pmode == 'deterministic' else 'LLM CALL'}")
            print(f"assess_evidence_sufficiency -> {'BYPASSED' if final_state.get('sufficiency_llm_invoked') is False else 'LLM CALL'}")
            print(f"targeted_retrieval -> USED: {final_state.get('targeted_retrieval_used')}")
            print("generate_assessment -> LLM CALL")
            print(f"validate_structured_output -> Error: {final_state.get('validation_errors')}")
            
            print(f"\nMETRICS:")
            print(f"Logical LLM calls: {final_state.get('llm_call_count')}")
            print(f"Fallback Used: {final_state.get('provider_fallback_used', False)}")
            print(f"Total Latency: {(t1-t0)*1000:.2f} ms")
            
            if final_state.get('provider_fallback_used', False) or (t1-t0) > 20.0:
                print("WARNING: Rate limit backoff or fallback detected!")
                
            if 'commander_response' in final_state and final_state['commander_response']:
                resp = final_state['commander_response']
                print(f"Assessment: {resp.assessment.summary[:200]}...")
                for r in resp.recommendations:
                    print(f"- {r.action}")
            else:
                print("FAILED TO GENERATE RESPONSE")
                
        except Exception as e:
            print(f"EXCEPTION: {e}")
            break

if __name__ == "__main__":
    run_layer_a()
    asyncio.run(run_layer_b())
