import os
from src.rag.models.document import DocumentMetadata

def _derive_source_and_name(file_name: str) -> tuple[str, str]:
    """Heuristic to derive source and name from the filename."""
    base_name = os.path.splitext(file_name)[0]
    
    if "NIST" in base_name.upper():
        source = "NIST"
        # Example: NIST.SP.800-82r3 -> NIST SP 800-82 Rev 3
        name = base_name.replace(".", " ").replace("r3", " Rev 3").replace("r1", " Rev 1")
    elif "CIGU" in base_name.upper():
        source = "CERT-In"
        name = base_name
    elif "IRPF" in base_name.upper():
        source = "CISA"
        name = "Infra Resilience Planning Framework"
    elif "mitre" in base_name.lower() or "ics-attack" in base_name.lower():
        source = "MITRE ATT&CK"
        name = "ICS ATT&CK"
    elif "cert" in base_name.lower():
        source = "CERT-In"
        name = base_name
    else:
        source = "Unknown"
        name = base_name
        
    return source, name

def generate_metadata_from_path(file_path: str, document_hash: str) -> DocumentMetadata:
    """Generates document metadata from the file path and hash."""
    path_parts = file_path.split(os.sep)
    file_name = path_parts[-1]
    
    # Try to find category from the folder right under 'knowledge'
    category = "unknown"
    try:
        knowledge_idx = path_parts.index("knowledge")
        if knowledge_idx + 1 < len(path_parts) - 1:
            category = path_parts[knowledge_idx + 1]
    except ValueError:
        # If 'knowledge' is not in the path, use the parent directory
        if len(path_parts) > 1:
            category = path_parts[-2]
            
    source, name = _derive_source_and_name(file_name)
    doc_type = os.path.splitext(file_name)[1].lower().strip('.')
    
    return DocumentMetadata(
        category=category,
        source=source,
        document_name=name,
        document_type=doc_type,
        document_hash=document_hash,
        extra={}
    )
