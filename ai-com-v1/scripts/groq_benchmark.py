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
            detection_type=DetectionType.network_intrusion,
            severity=Severity.critical,
            confidence=0.95,
            risk_score=95.0,
            affected_endpoints=["water-scada-hmi"],
            metadata={"description": "Water facility unauthorized access"}
        ),
        # INC-003
        DetectionInput(
            incident_id="INC-003",
            timestamp=datetime.now(),
            detection_type=DetectionType.malware_detected,
            severity=Severity.medium,
            confidence=0.7,
            risk_score=60.0,
            affected_endpoints=["traffic-mgmt-node"],
            metadata={"description": "Traffic control malware"}
        ),
        # INC-004
        DetectionInput(
            incident_id="INC-004",
            timestamp=datetime.now(),
            detection_type=DetectionType.network_intrusion,
            severity=Severity.high,
            confidence=0.85,
            risk_score=75.0,
            affected_endpoints=["smart-meter-gateway"],
            metadata={"description": "Energy grid network intrusion"}
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
            metadata={"description": "Municipal auth DoS"}
        )
    ]
    
    inc_006 = CampaignInput(
        campaign_id="INC-006",
        campaign_type="APT",
        confidence=0.8,
        correlations=["cor-1"],
        incidents=[incidents[0]]
    )
    
    inputs = incidents + [inc_006]
    results = []
    
    for inc in inputs:
        log_id = inc.incident_id if hasattr(inc, "incident_id") else inc.campaign_id
        print(f"\n--- Running {log_id} ---", flush=True)
        t0 = time.time()
        
        initial_state = {
            "analysis_mode": "campaign" if hasattr(inc, "campaign_id") else "incident",
            "campaign_input": inc if hasattr(inc, "campaign_id") else None,
            "incident_input": inc if not hasattr(inc, "campaign_id") else None,
            "llm_call_count": 0,
            "correction_attempts": 0,
            "error": None
        }
        
        final_state = await service.graph.ainvoke(initial_state)
        
        total_lat = (time.time() - t0) * 1000
        calls = final_state.get('llm_call_count', 0)
        provider = final_state.get('llm_provider', 'unknown')
        success = "commander_response" in final_state and final_state["commander_response"] is not None
        ass_lat = final_state.get("assessment_latency_ms", 0)
        
        results.append({
            "incident": log_id,
            "provider": provider,
            "calls": calls,
            "latency": total_lat,
            "ass_lat": ass_lat,
            "success": success
        })
        print(f"Done: {calls} calls, {total_lat:.2f}ms, Success={success}")

    print("\n================ SUMMARY ================")
    print(f"{'Incident':<12} | {'Provider':<8} | {'Calls':<5} | {'Latency(ms)':<12} | {'Assmnt(ms)':<10} | {'Result'}")
    for r in results:
        print(f"{r['incident']:<12} | {r['provider']:<8} | {r['calls']:<5} | {r['latency']:<12.2f} | {r['ass_lat']:<10.2f} | {r['success']}")

if __name__ == "__main__":
    asyncio.run(run_diagnostics())
