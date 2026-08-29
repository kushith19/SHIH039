import asyncio
import sys
import os
import time
from datetime import datetime

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.services.commander_service import CommanderService
from src.models.detection import DetectionInput, Severity, DetectionType, CampaignInput
from src.config.settings import settings

async def run_diagnostics():
    settings.llm_provider = "groq"
    service = CommanderService()
    
    incidents = [
        # INC-001
        DetectionInput(
            incident_id="INC-001",
            timestamp=datetime.now(),
            detection_type=DetectionType.behavioral_anomaly,
            severity=Severity.high,
            confidence=0.9,
            risk_score=80.0,
            affected_endpoints=["hosp-network", "telecom-bridge"],
            metadata={"description": "Hospital/telecom anomaly"}
        ),
        # INC-002
        DetectionInput(
            incident_id="INC-002",
            timestamp=datetime.now(),
            detection_type=DetectionType.behavioral_anomaly,
            severity=Severity.critical,
            confidence=0.9,
            risk_score=95.0,
            affected_endpoints=["water-scada", "plc-01"],
            metadata={"description": "Water treatment OT/ICS anomaly"}
        ),
        # INC-003
        DetectionInput(
            incident_id="INC-003",
            timestamp=datetime.now(),
            detection_type=DetectionType.behavioral_anomaly,
            severity=Severity.medium,
            confidence=0.7,
            risk_score=60.0,
            affected_endpoints=["traffic-mgmt"],
            metadata={"description": "Traffic-management anomaly"}
        ),
        # INC-004
        DetectionInput(
            incident_id="INC-004",
            timestamp=datetime.now(),
            detection_type=DetectionType.behavioral_anomaly,
            severity=Severity.high,
            confidence=0.85,
            risk_score=75.0,
            affected_endpoints=["smart-meter-grid"],
            metadata={"description": "Smart-meter energy anomaly"}
        ),
        # INC-005
        DetectionInput(
            incident_id="INC-005",
            timestamp=datetime.now(),
            detection_type=DetectionType.behavioral_anomaly,
            severity=Severity.medium,
            confidence=0.6,
            risk_score=50.0,
            affected_endpoints=["auth-server-muni"],
            metadata={"description": "Municipal authentication anomaly"}
        )
    ]
    
    # INC-006: Campaign
    inc_006 = CampaignInput(
        campaign_id="INC-006",
        campaign_type="APT",
        confidence=0.8,
        correlations=["cor-1"],
        incidents=[
            DetectionInput(
                incident_id="INC-006-A",
                timestamp=datetime.now(),
                detection_type=DetectionType.behavioral_anomaly,
                severity=Severity.critical,
                confidence=0.9,
                risk_score=90.0,
                affected_endpoints=["hosp-network", "water-scada"],
                metadata={"description": "Cross-sector correlation"}
            )
        ]
    )
    
    inputs = incidents + [inc_006]
    
    results = []
    
    for i, inc in enumerate(inputs):
        log_id = inc.incident_id if hasattr(inc, "incident_id") else inc.campaign_id
        print(f"\n--- Running {log_id} ---")
        t0 = time.time()
        
        # We need state! We'll just run graph directly to get state.
        if hasattr(inc, "campaign_id"):
            initial_state = {
                "analysis_mode": "campaign",
                "campaign_input": inc,
                "llm_call_count": 0,
                "correction_attempts": 0,
                "error": None
            }
        else:
            initial_state = {
                "analysis_mode": "incident",
                "incident_input": inc,
                "llm_call_count": 0,
                "correction_attempts": 0,
                "error": None
            }
        
        final_state = await service.graph.ainvoke(initial_state)
        
        total_lat = (time.time() - t0) * 1000
        print(f"Total Latency: {total_lat:.2f}ms")
        print(f"LLM Calls: {final_state.get('llm_call_count', 0)}")
        print(f"Planner Mode: {final_state.get('planner_mode', 'unknown')}")
        print(f"Sufficiency LLM Invoked: {final_state.get('sufficiency_llm_invoked', False)}")
        print(f"Targeted Retrieval Used: {final_state.get('targeted_retrieval_used', False)}")
        print(f"Correction Latency: {final_state.get('correction_latency_ms', 0)}ms")
        print(f"Safety Correction Latency: {final_state.get('safety_correction_latency_ms', 0)}ms")
        
        results.append({
            "incident": log_id,
            "calls": final_state.get('llm_call_count', 0),
            "latency": total_lat,
            "planner_mode": final_state.get("planner_mode"),
            "sufficiency_llm": final_state.get("sufficiency_llm_invoked"),
            "targeted": final_state.get("targeted_retrieval_used"),
            "assessment": final_state.get("assessment_latency_ms") is not None,
            "correction": final_state.get("correction_latency_ms", 0) > 0,
            "safety_correction": final_state.get("safety_correction_latency_ms", 0) > 0,
            "provider": final_state.get("llm_provider", "unknown"),
            "fallback": final_state.get("provider_fallback_used", False),
            "success": "assessment" in final_state and len(final_state["assessment"]) > 10
        })
        
    print("\n================ SUMMARY ================")
    print(f"{'Incident':<12} | {'Calls':<5} | {'Latency(ms)':<10} | {'Provider':<8} | {'Fallback':<8} | {'Success':<8}")
    for r in results:
        print(f"{r['incident']:<12} | {r['calls']:<5} | {r['latency']:<10.2f} | {r['provider']:<8} | {str(r['fallback']):<8} | {str(r['success']):<8}")

if __name__ == "__main__":
    asyncio.run(run_diagnostics())
