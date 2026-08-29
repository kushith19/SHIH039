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
    
    inc = DetectionInput(
        incident_id="INC-001",
        timestamp=datetime.now(),
        detection_type=DetectionType.behavioral_anomaly,
        severity=Severity.high,
        confidence=0.9,
        risk_score=80.0,
        affected_endpoints=["hosp-network", "telecom-bridge"],
        metadata={"description": "Hospital/telecom anomaly"}
    )
    
    inc_006 = CampaignInput(
        campaign_id="INC-006",
        campaign_type="APT",
        confidence=0.8,
        correlations=["cor-1"],
        incidents=[inc]
    )
    
    print(f"\n--- Running INC-006 ---", flush=True)
    t0 = time.time()
    
    initial_state = {
        "analysis_mode": "campaign",
        "campaign_input": inc_006,
        "llm_call_count": 0,
        "correction_attempts": 0,
        "error": None
    }
    
    final_state = await service.graph.ainvoke(initial_state)
    
    total_lat = (time.time() - t0) * 1000
    
    print(f"Total Latency: {total_lat:.2f} ms")
    print(f"LLM Calls: {final_state.get('llm_call_count', 0)}")
    print(f"Provider: {final_state.get('llm_provider', 'unknown')}")
    print(f"Model: {final_state.get('llm_model', 'unknown')}")
    print(f"Fallback Used: {final_state.get('provider_fallback_used', False)}")
    print(f"Success: {'commander_response' in final_state and final_state['commander_response'] is not None}")

if __name__ == "__main__":
    asyncio.run(run_diagnostics())
