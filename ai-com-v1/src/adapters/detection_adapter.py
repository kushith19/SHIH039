from typing import Optional
from abc import ABC, abstractmethod
from datetime import datetime, timezone

from src.models.detection import DetectionInput, DetectionType, Severity

class DetectionAdapter(ABC):
    @abstractmethod
    async def get_detection(self, incident_id: str) -> Optional[DetectionInput]:
        """Fetch detection details by incident ID."""
        pass

class MockDetectionAdapter(DetectionAdapter):
    async def get_detection(self, incident_id: str) -> Optional[DetectionInput]:
        # Deterministic sample incidents for development
        now = datetime.now(timezone.utc)
        
        scenarios = {
            "INC-001": DetectionInput(
                incidentId="INC-001",
                timestamp=now,
                detectionType=DetectionType.behavioral_anomaly,
                severity=Severity.high,
                confidence=0.91,
                riskScore=0.91,
                affectedEndpoints=[
                    "telecom-network-gateway",
                    "hospital-api-gateway",
                    "hospital-emr"
                ],
                evidence=[
                    {"code": "metric_deviation", "kind": "behavioural_anomaly", "metric": "packetsPerSecond", "expected": 120, "observed": 196, "deviationPct": 63, "detail": "metric_deviation:packetsPerSecond"},
                    {"code": "edge_pps", "kind": "communication_anomaly", "metric": "packetsPerSecond", "expected": 80, "observed": 118, "deviationPct": 48, "detail": "edge_pps:telecom-hospital"},
                    {"code": "peer_trust_decrease", "kind": "dependency_anomaly", "previous": 82, "current": 54, "detail": "peer_trust_decrease:82->54"},
                    {"code": "neighbor_set_change", "kind": "structural_anomaly", "neighborDelta": 3, "windowSeconds": 8, "previousCount": 1, "currentCount": 4, "detail": "neighbor_set_change:3@8s"},
                    {"code": "critical_infrastructure", "kind": "other", "criticality": "high", "sector": "healthcare", "detail": "endpoint is critical infrastructure"},
                ],
                metadata={
                    "source": "mock_tgnn"
                }
            ),
            "INC-002": DetectionInput(
                incidentId="INC-002",
                timestamp=now,
                detectionType=DetectionType.behavioral_anomaly,
                severity=Severity.critical,
                confidence=0.88,
                riskScore=0.95,
                affectedEndpoints=[
                    "water-treatment-control",
                    "water-distribution-management",
                    "water-quality-monitoring",
                    "smart-water-meter-gateway"
                ],
                evidence=[
                    {"code": "metric_deviation", "kind": "behavioural_anomaly", "metric": "packetsPerSecond", "expected": 90, "observed": 210, "deviationPct": 133, "detail": "metric_deviation:packetsPerSecond"},
                    {"code": "metric_deviation", "kind": "behavioural_anomaly", "metric": "httpRequestsPerMin", "expected": 40, "observed": 88, "deviationPct": 120, "detail": "metric_deviation:httpRequestsPerMin"},
                    {"code": "peer_trust_decrease", "kind": "dependency_anomaly", "previous": 78, "current": 41, "detail": "peer_trust_decrease:78->41"},
                    {"code": "critical_infrastructure", "kind": "other", "criticality": "critical", "sector": "water", "detail": "endpoint is critical infrastructure"},
                ],
                metadata={
                    "source": "mock_tgnn_ot"
                }
            ),
            "INC-003": DetectionInput(
                incidentId="INC-003",
                timestamp=now,
                detectionType=DetectionType.network_intrusion,
                severity=Severity.high,
                confidence=0.85,
                riskScore=0.89,
                affectedEndpoints=[
                    "traffic-management-controller",
                    "traffic-sensor-gateway"
                ],
                evidence=[
                    {"code": "edge_pps", "kind": "communication_anomaly", "metric": "packetsPerSecond", "expected": 55, "observed": 102, "deviationPct": 85, "detail": "edge_pps:traffic-sensor"},
                    {"code": "neighbor_set_change", "kind": "structural_anomaly", "neighborDelta": 2, "windowSeconds": 8, "previousCount": 1, "currentCount": 3, "detail": "neighbor_set_change:2@8s"},
                    {"code": "peer_trust_decrease", "kind": "dependency_anomaly", "previous": 74, "current": 58, "detail": "peer_trust_decrease:74->58"},
                    {"code": "critical_infrastructure", "kind": "other", "criticality": "high", "sector": "traffic", "detail": "endpoint is critical infrastructure"},
                ],
                metadata={
                    "source": "mock_tgnn_traffic"
                }
            ),
            "INC-004": DetectionInput(
                incidentId="INC-004",
                timestamp=now,
                detectionType=DetectionType.behavioral_anomaly,
                severity=Severity.medium,
                confidence=0.82,
                riskScore=0.75,
                affectedEndpoints=[
                    "smart-meter-gateway",
                    "power-substation-controller",
                    "scada-control-server"
                ],
                evidence=[
                    {"code": "metric_deviation", "kind": "behavioural_anomaly", "metric": "packetsPerSecond", "expected": 70, "observed": 105, "deviationPct": 50, "detail": "metric_deviation:packetsPerSecond"},
                    {"code": "edge_pps", "kind": "communication_anomaly", "metric": "packetsPerSecond", "expected": 40, "observed": 61, "deviationPct": 52, "detail": "edge_pps:meter-scada"},
                    {"code": "critical_infrastructure", "kind": "other", "criticality": "high", "sector": "energy", "detail": "endpoint is critical infrastructure"},
                ],
                metadata={
                    "source": "mock_tgnn_energy"
                }
            ),
            "INC-005": DetectionInput(
                incidentId="INC-005",
                timestamp=now,
                detectionType=DetectionType.behavioral_anomaly,
                severity=Severity.high,
                confidence=0.89,
                riskScore=0.84,
                affectedEndpoints=[
                    "government-identity-service",
                    "government-network-gateway",
                    "municipal-management-system"
                ],
                evidence=[
                    {"code": "metric_deviation", "kind": "behavioural_anomaly", "metric": "failedLoginsPerMin", "expected": 2, "observed": 18, "deviationPct": 800, "detail": "metric_deviation:failedLoginsPerMin"},
                    {"code": "metric_deviation", "kind": "behavioural_anomaly", "metric": "httpRequestsPerMin", "expected": 30, "observed": 54, "deviationPct": 80, "detail": "metric_deviation:httpRequestsPerMin"},
                    {"code": "peer_trust_decrease", "kind": "dependency_anomaly", "previous": 80, "current": 61, "detail": "peer_trust_decrease:80->61"},
                    {"code": "critical_infrastructure", "kind": "other", "criticality": "high", "sector": "government", "detail": "endpoint is critical infrastructure"},
                ],
                metadata={
                    "source": "mock_tgnn_gov"
                }
            ),
            "INC-006": DetectionInput(
                incidentId="INC-006",
                timestamp=now,
                detectionType=DetectionType.behavioral_anomaly,
                severity=Severity.critical,
                confidence=0.96,
                riskScore=0.98,
                affectedEndpoints=[
                    "hospital-api-gateway",
                    "water-distribution-management",
                    "traffic-management-controller",
                    "telecom-network-gateway",
                    "government-identity-service"
                ],
                evidence=[
                    {"code": "metric_deviation", "kind": "behavioural_anomaly", "metric": "packetsPerSecond", "expected": 100, "observed": 175, "deviationPct": 75, "detail": "metric_deviation:packetsPerSecond"},
                    {"code": "peer_trust_decrease", "kind": "dependency_anomaly", "previous": 85, "current": 47, "detail": "peer_trust_decrease:85->47"},
                    {"code": "neighbor_set_change", "kind": "structural_anomaly", "neighborDelta": 4, "windowSeconds": 8, "previousCount": 2, "currentCount": 6, "detail": "neighbor_set_change:4@8s"},
                    {"code": "critical_infrastructure", "kind": "other", "criticality": "critical", "sector": "healthcare", "detail": "endpoint is critical infrastructure"},
                ],
                metadata={
                    "source": "mock_tgnn_fusion"
                }
            )
        }
        
        return scenarios.get(incident_id)
