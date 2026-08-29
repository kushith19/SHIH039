import asyncio
import os
from src.adapters.detection_adapter import MockDetectionAdapter
from src.services.commander_service import CommanderService

async def main():
    adapter = MockDetectionAdapter()
    detection = await adapter.get_detection("INC-001")
    
    print(f"Loaded detection: {detection.incident_id}")
    
    service = CommanderService()
    try:
        response = await service.analyze_detection(detection)
        print("Success! Response:")
        print(response.model_dump_json(indent=2))
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
