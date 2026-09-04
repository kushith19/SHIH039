from typing import List, Optional, Literal
from pydantic import BaseModel, Field, field_validator, model_validator
import re

from src.models.detection import DetectionInput, CampaignInput

class CommanderRequest(BaseModel):
    incident_id: Optional[str] = Field(alias="incidentId", default=None)
    detection: Optional[DetectionInput] = None
    analysis_mode: Optional[Literal["incident", "campaign"]] = Field(alias="analysisMode", default=None)
    campaign_input: Optional[CampaignInput] = Field(alias="campaignInput", default=None)

    @model_validator(mode="after")
    def require_id_or_detection(self) -> "CommanderRequest":
        if self.campaign_input is not None:
            return self
        if not self.incident_id and self.detection is None:
            raise ValueError("incidentId, detection, or campaignInput is required")
        if self.detection is not None and not self.incident_id:
            self.incident_id = self.detection.incident_id
        return self

    class Config:
        populate_by_name = True

class Assessment(BaseModel):
    severity: str
    summary: str
    confidence: float

class Impact(BaseModel):
    affected_endpoints: List[str] = Field(alias="affectedEndpoints", default_factory=list)
    affected_sectors: List[str] = Field(alias="affectedSectors", default_factory=list)
    critical_infrastructure: List[str] = Field(alias="criticalInfrastructure", default_factory=list)

    class Config:
        populate_by_name = True

class Evidence(BaseModel):
    type: str
    description: str
    source: Optional[str] = None
    document: Optional[str] = None
    section: Optional[str] = None
    page: Optional[int] = None
    
    @field_validator("page", mode="before")
    @classmethod
    def parse_page(cls, v):
        if v is None:
            return None
        if isinstance(v, int):
            return v
        if isinstance(v, str):
            match = re.search(r'\d+', v)
            if match:
                return int(match.group())
        return v

class Recommendation(BaseModel):
    action: str
    priority: str

class RiskBreakdown(BaseModel):
    overall: Optional[int] = None
    behavioral: Optional[int] = None
    graph: Optional[int] = None
    trust: Optional[int] = None
    criticality: Optional[int] = None
    propagation: Optional[int] = None

class GraphContext(BaseModel):
    affected_nodes: List[str] = Field(alias="affectedNodes", default_factory=list)
    affected_edges: List[str] = Field(alias="affectedEdges", default_factory=list)
    propagation_path: List[str] = Field(alias="propagationPath", default_factory=list)
    hop_count: Optional[int] = Field(alias="hopCount", default=None)
    exposed_count: Optional[int] = Field(alias="exposedCount", default=None)

    class Config:
        populate_by_name = True

class MitreCandidate(BaseModel):
    technique_id: str = Field(alias="techniqueId")
    tactic: Optional[str] = None
    confidence: Optional[float] = None
    reason: Optional[str] = None

    class Config:
        populate_by_name = True

class ResponseStep(BaseModel):
    phase: str = "contain"
    priority: str = "P1"
    action: str
    rationale: Optional[str] = None
    safety_status: Literal["approved", "corrected", "dropped"] = Field(
        alias="safetyStatus", default="approved"
    )

    class Config:
        populate_by_name = True

class Epistemic(BaseModel):
    observed: Optional[str] = None
    graph: Optional[str] = None
    knowledge: Optional[str] = None
    inference: Optional[str] = None
    hypothesis: Optional[str] = None

class CommanderResponse(BaseModel):
    analysis_mode: Literal["incident", "campaign"] = Field(default="incident")
    incident_id: Optional[str] = Field(alias="incidentId", default=None)
    campaign_id: Optional[str] = Field(alias="campaignId", default=None)
    assessment: Assessment
    impact: Impact
    evidence: List[Evidence] = Field(default_factory=list)
    recommendations: List[Recommendation] = Field(default_factory=list)
    risk: Optional[RiskBreakdown] = None
    graph_context: Optional[GraphContext] = Field(alias="graphContext", default=None)
    mitre_candidates: List[MitreCandidate] = Field(alias="mitreCandidates", default_factory=list)
    response_plan: List[ResponseStep] = Field(alias="responsePlan", default_factory=list)
    investigation_steps: List[str] = Field(alias="investigationSteps", default_factory=list)
    citations: List[Evidence] = Field(default_factory=list)
    uncertainties: List[str] = Field(default_factory=list)
    knowledge_status: Literal["success", "degraded", "unavailable"] = Field(
        alias="knowledgeStatus", default="unavailable"
    )
    epistemic: Optional[Epistemic] = None
    financial_impact: Optional[str] = Field(alias="financialImpact", default=None)

    @model_validator(mode="after")
    def validate_ids(self) -> "CommanderResponse":
        if self.analysis_mode == "incident" and not self.incident_id:
            raise ValueError("incident_id is required when analysis_mode is 'incident'")
        if self.analysis_mode == "campaign" and not self.campaign_id:
            raise ValueError("campaign_id is required when analysis_mode is 'campaign'")
        return self

    class Config:
        populate_by_name = True

class ExplainResponse(BaseModel):
    incident_id: Optional[str] = Field(alias="incidentId", default=None)
    summary: str

    class Config:
        populate_by_name = True

class AskRequest(BaseModel):
    question: str
    snapshot: dict = Field(default_factory=dict)

class AskResponse(BaseModel):
    answer: str
    insufficient: bool = False


class KnowledgeSource(BaseModel):
    document: Optional[str] = None
    source: Optional[str] = None
    section: Optional[str] = None
    page: Optional[int] = None
    score: Optional[float] = None
    category: Optional[str] = None


class KnowledgeContextBody(BaseModel):
    """Informational knowledge only — never contains executable actions."""

    retrieved: bool = False
    reason: Optional[str] = None
    knowledge_status: Literal["success", "degraded", "unavailable"] = Field(
        alias="knowledgeStatus", default="unavailable"
    )
    attack_understanding: List[str] = Field(
        alias="attackUnderstanding", default_factory=list
    )
    relevant_knowledge: List[str] = Field(
        alias="relevantKnowledge", default_factory=list
    )
    prevention_guidance: List[str] = Field(
        alias="preventionGuidance", default_factory=list
    )
    sources: List[KnowledgeSource] = Field(default_factory=list)
    queries: List[str] = Field(default_factory=list)

    class Config:
        populate_by_name = True


class KnowledgeRequest(BaseModel):
    """Knowledge-only enrichment. Does not produce a response plan."""

    detection: Optional[DetectionInput] = None
    query: Optional[str] = None
    incident_hints: Optional[dict] = Field(alias="incidentHints", default=None)
    question: Optional[str] = None
    live_facts: Optional[dict] = Field(alias="liveFacts", default=None)

    class Config:
        populate_by_name = True


class KnowledgeAskResponse(BaseModel):
    answer: str
    insufficient: bool = False
    knowledge_context: Optional[KnowledgeContextBody] = Field(
        alias="knowledgeContext", default=None
    )

    class Config:
        populate_by_name = True


class ResponsePlanRequest(BaseModel):
    """LLM Commander planner input — facts + allowlisted action IDs only."""

    planning_context: dict = Field(alias="planningContext")

    class Config:
        populate_by_name = True


class ResponsePlanActionsResponse(BaseModel):
    """Rich Commander plan. Match server remains authoritative for execution."""

    summary: Optional[str] = None
    attackInterpretation: Optional[str] = None
    strategy: Optional[str] = None
    actions: List[dict] = Field(default_factory=list)
    riskAssessment: Optional[str] = None
    confidence: Optional[float] = None
    uncertainty: Optional[str] = None
    raw: Optional[str] = None
    provider: Optional[str] = None
