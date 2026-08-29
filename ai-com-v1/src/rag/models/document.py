from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field

class DocumentMetadata(BaseModel):
    """Metadata describing a parsed document."""
    category: str = Field(description="The category of the document, typically derived from directory structure.")
    source: str = Field(description="The source of the document (e.g. NIST, MITRE, CERT-In).")
    document_name: str = Field(description="The specific name of the document or standard.")
    document_type: str = Field(description="The type of the document (e.g., pdf, json).")
    document_hash: str = Field(description="Deterministic SHA-256 hash of the original source file.")
    extra: Dict[str, Any] = Field(default_factory=dict, description="Additional arbitrary metadata (e.g., technique_id).")

class DocumentChunk(BaseModel):
    """A chunk of a document ready for embedding/retrieval."""
    chunk_id: str = Field(description="Deterministic chunk ID (e.g., hash of document_hash + section/page + index).")
    text: str = Field(description="The actual text content of the chunk.")
    metadata: DocumentMetadata = Field(description="Metadata of the parent document.")
    section: Optional[str] = Field(default=None, description="The heading/section this chunk belongs to.")
    page_number: Optional[int] = Field(default=None, description="The page number where this chunk starts.")

class RetrievedChunk(BaseModel):
    chunk_id: str
    text: str
    score: float
    rank: int
    source: str
    document_name: str
    category: str
    section: Optional[str] = None
    page_number: Optional[int] = None
    metadata: DocumentMetadata

class RetrievalResult(BaseModel):
    results: List[RetrievedChunk]
    embedding_latency_ms: float
    search_latency_ms: float
    total_latency_ms: float
