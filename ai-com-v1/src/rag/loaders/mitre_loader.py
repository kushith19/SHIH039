import json
import hashlib
from typing import List
from src.rag.models.document import DocumentChunk, DocumentMetadata

def get_file_hash(file_path: str) -> str:
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def _generate_chunk_id(doc_hash: str, stix_id: str) -> str:
    raw = f"{doc_hash}_{stix_id}".encode('utf-8')
    return hashlib.sha256(raw).hexdigest()

def process_mitre_json(file_path: str, metadata: DocumentMetadata) -> List[DocumentChunk]:
    """
    Parses a MITRE ATT&CK STIX JSON file and extracts techniques and mitigations.
    Returns a list of DocumentChunks.
    """
    chunks = []
    
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    objects = data.get("objects", [])
    
    for obj in objects:
        obj_type = obj.get("type")
        
        if obj_type in ["attack-pattern", "course-of-action"]:
            stix_id = obj.get("id", "")
            name = obj.get("name", "")
            description = obj.get("description", "")
            
            if not description:
                continue
                
            external_refs = obj.get("external_references", [])
            mitre_id = "Unknown"
            url = ""
            for ref in external_refs:
                if ref.get("source_name") == "mitre-ics-attack" or ref.get("source_name") == "mitre-attack":
                    mitre_id = ref.get("external_id", "Unknown")
                    url = ref.get("url", "")
                    break
                    
            # For techniques, extract tactics
            tactics = []
            if obj_type == "attack-pattern":
                kill_chain_phases = obj.get("kill_chain_phases", [])
                for phase in kill_chain_phases:
                    if phase.get("kill_chain_name") == "mitre-ics-attack" or phase.get("kill_chain_name") == "mitre-attack":
                        tactics.append(phase.get("phase_name"))
                        
            chunk_text = f"Name: {name}\n"
            chunk_text += f"Type: {obj_type}\n"
            chunk_text += f"MITRE ID: {mitre_id}\n"
            if tactics:
                chunk_text += f"Tactics: {', '.join(tactics)}\n"
            chunk_text += f"\nDescription:\n{description}"
            
            # Update metadata for this specific chunk
            chunk_meta = metadata.model_copy(deep=True)
            chunk_meta.extra["mitre_id"] = mitre_id
            chunk_meta.extra["stix_id"] = stix_id
            chunk_meta.extra["url"] = url
            if tactics:
                chunk_meta.extra["tactics"] = tactics
                
            chunk_id = _generate_chunk_id(metadata.document_hash, stix_id)
            
            chunks.append(DocumentChunk(
                chunk_id=chunk_id,
                text=chunk_text,
                metadata=chunk_meta,
                section=name,
                page_number=None
            ))
            
    return chunks
