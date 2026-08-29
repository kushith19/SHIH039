import requests
import time
t0 = time.time()
response = requests.post(
    'http://127.0.0.1:8000/commander/analyze',
    json={"incident_id": "INC-001"}
)
t1 = time.time()
print(f"Latency: {(t1-t0)*1000:.2f} ms")
print(response.json())
