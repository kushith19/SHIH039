from typing import List, Optional, Literal
from pydantic import BaseModel, Field, field_validator, model_validator
import re

from src.models.detection import DetectionInput

class CommanderRequest(BaseModel):
    incident_id: Optional[str] = Field(alias="incidentId", default=None)
    detection: Optional[DetectionInput] = None

    @model_validator(mode="after")
    def require_id_or_detection(self) -> "CommanderRequest":
        if not self.incident_id and self.detection is None:
            raise ValueError("incidentId or detection is required")
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

class CommanderResponse(BaseModel):
    analysis_mode: Literal["incident", "campaign"] = Field(default="incident")
    incident_id: Optional[str] = Field(alias="incidentId", default=None)
    campaign_id: Optional[str] = Field(alias="campaignId", default=None)
    assessment: Assessment
    impact: Impact
    evidence: List[Evidence] = Field(default_factory=list)
    recommendations: List[Recommendation] = Field(default_factory=list)

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
