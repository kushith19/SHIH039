import os
import json
import pytest
from src.rag.loaders.mitre_loader import process_mitre_json
from src.rag.models.document import DocumentMetadata

@pytest.fixture
def sample_mitre_json(tmp_path):
    data = {
        "objects": [
            {
                "type": "attack-pattern",
                "id": "attack-pattern--12345",
                "name": "Test Technique",
                "description": "This is a test technique.",
                "external_references": [
                    {
                        "source_name": "mitre-ics-attack",
                        "external_id": "T1234",
                        "url": "https://attack.mitre.org/techniques/T1234"
                    }
                ],
                "kill_chain_phases": [
                    {
                        "kill_chain_name": "mitre-ics-attack",
                        "phase_name": "execution"
                    }
                ]
            },
            {
                "type": "course-of-action",
                "id": "course-of-action--67890",
                "name": "Test Mitigation",
                "description": "Mitigate the test technique."
            }
        ]
    }
    
    file_path = tmp_path / "test_mitre.json"
    with open(file_path, "w") as f:
        json.dump(data, f)
        
    return str(file_path)

def test_process_mitre_json(sample_mitre_json):
    metadata = DocumentMetadata(
        category="attack-intelligence", source="MITRE", document_name="ICS",
        document_type="json", document_hash="testhash", extra={}
    )
    
    chunks = process_mitre_json(sample_mitre_json, metadata)
    
    assert len(chunks) == 2
    
    tech_chunk = chunks[0]
    assert tech_chunk.section == "Test Technique"
    assert "Type: attack-pattern" in tech_chunk.text
    assert "MITRE ID: T1234" in tech_chunk.text
    assert "execution" in tech_chunk.text
    assert tech_chunk.metadata.extra["mitre_id"] == "T1234"
    assert tech_chunk.metadata.extra["tactics"] == ["execution"]
    
    mit_chunk = chunks[1]
    assert mit_chunk.section == "Test Mitigation"
    assert "Type: course-of-action" in mit_chunk.text
