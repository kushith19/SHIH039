import asyncio
import sys
import os
import time
from datetime import datetime
import json

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
    
    initial_state = {
        "analysis_mode": "incident",
        "incident_input": inc,
        "llm_call_count": 0,
        "correction_attempts": 0,
        "error": None
    }
    
    final_state = await service.graph.ainvoke(initial_state)
    
    print("=== VALIDATION ERRORS ===")
    print(final_state.get('validation_errors', 'None'))
    print("=== RAW LLM OUTPUT ===")
    print(final_state.get('raw_llm_output', 'None'))

if __name__ == "__main__":
    asyncio.run(run_diagnostics())
