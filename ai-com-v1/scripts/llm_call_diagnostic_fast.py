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
    settings.llm_provider = "ollama"
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
        )
    ]
    
    for inc in incidents:
        print(f"\n--- Running {inc.incident_id} ---", flush=True)
        t0 = time.time()
        
        initial_state = {
            "analysis_mode": "incident",
            "incident_input": inc,
            "llm_call_count": 0,
            "correction_attempts": 0,
            "error": None
        }
        
        final_state = await service.graph.ainvoke(initial_state)
        
        print(f"Total Latency: {(time.time() - t0) * 1000:.2f}ms", flush=True)
        print(f"LLM Calls: {final_state.get('llm_call_count', 0)}", flush=True)
        print(f"Planner Mode: {final_state.get('planner_mode', 'unknown')}", flush=True)

if __name__ == "__main__":
    asyncio.run(run_diagnostics())
