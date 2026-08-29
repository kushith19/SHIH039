from typing import List, Optional
from enum import Enum
from pydantic import BaseModel, Field

class RetrievalPriority(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"

class KnowledgeCategory(str, Enum):
    IOT = "iot"
    ATTACK_INTELLIGENCE = "attack-intelligence"
    OT_ICS = "ot-ics"
    SMART_CITY = "smart-city"
    INDIA = "india"
    RESILIENCE = "resilience"
    INCIDENT_RESPONSE = "incident-response"

class RetrievalQuery(BaseModel):
    query: str = Field(description="The semantic search query.")
    category: Optional[KnowledgeCategory] = Field(default=None, description="Optional category filter.")
    source: Optional[str] = Field(default=None, description="Optional source organization filter (e.g., NIST, CISA).")
    rationale: str = Field(description="Why this knowledge is needed for the assessment.")
    priority: RetrievalPriority = Field(default=RetrievalPriority.MEDIUM)

class RetrievalPlan(BaseModel):
    queries: List[RetrievalQuery] = Field(description="List of knowledge queries to execute. Minimum 1, Maximum 4.", min_length=1, max_length=4)

class RetrievedEvidence(BaseModel):
    retrieval_queries: List[str] = Field(description="The queries that surfaced this chunk.")
    score: float
    source: str
    document_name: str
    category: str
    section: Optional[str] = None
    page_number: Optional[int] = None
    chunk_id: str
    text: str

class MissingDomain(str, Enum):
    ANOMALY_BEHAVIOR = "anomaly_behavior"
    INFRASTRUCTURE_DOMAIN = "infrastructure_domain"
    INCIDENT_RESPONSE = "incident_response"
    OT_ICS = "ot_ics"
    SMART_CITY = "smart_city"
    RESILIENCE = "resilience"
    INDIA = "india"

class EvidenceSufficiency(BaseModel):
    sufficient: bool = Field(description="Whether the retrieved evidence is sufficient to assess the incident.")
    confidence: float = Field(description="Confidence in this sufficiency assessment (0.0 to 1.0).", ge=0.0, le=1.0)
    missing_domains: List[MissingDomain] = Field(description="List of domains that need targeted retrieval. Empty if sufficient.", default_factory=list)
    rationale: str = Field(description="Short rationale explaining the sufficiency decision.")
