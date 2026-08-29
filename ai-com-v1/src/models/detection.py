from datetime import datetime
from enum import Enum
from typing import List, Dict, Any

from pydantic import BaseModel, Field

class Severity(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"

class DetectionType(str, Enum):
    behavioral_anomaly = "behavioral_anomaly"
    behavioural_anomaly = "behavioural_anomaly"
    network_intrusion = "network_intrusion"
    malware_detected = "malware_detected"
    data_exfiltration = "data_exfiltration"
    communication_anomaly = "communication_anomaly"
    temporal_anomaly = "temporal_anomaly"
    dependency_anomaly = "dependency_anomaly"
    structural_anomaly = "structural_anomaly"
    graph_propagation = "graph_propagation"
    unknown = "unknown"

class DetectionInput(BaseModel):
    incident_id: str = Field(alias="incidentId")
    timestamp: datetime
    detection_type: DetectionType = Field(alias="detectionType")
    severity: Severity
    confidence: float = Field(ge=0.0, le=1.0)
    risk_score: float = Field(alias="riskScore", ge=0.0)
    affected_endpoints: List[str] = Field(alias="affectedEndpoints", default_factory=list)
    # Level-1 engine facts (loose dicts). Typical keys: code, kind, detail, metric,
    # observed, expected, deviationPct, previous, current, neighborDelta, windowSeconds, criticality, sector, score.
    evidence: List[Dict[str, Any]] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        populate_by_name = True

class CampaignInput(BaseModel):
    campaign_id: str = Field(alias="campaignId", min_length=1)
    campaign_type: str = Field(alias="campaignType")
    confidence: float = Field(ge=0.0, le=1.0)
    incidents: List[DetectionInput] = Field(min_length=1)
    correlations: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    class Config:
        populate_by_name = True
