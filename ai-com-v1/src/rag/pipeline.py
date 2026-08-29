import os
import json
import argparse
from typing import List
from src.rag.loaders.pdf_loader import process_pdf, get_file_hash as get_pdf_hash
from src.rag.loaders.mitre_loader import process_mitre_json, get_file_hash as get_mitre_hash
from src.rag.preprocessing.metadata import generate_metadata_from_path
from src.rag.preprocessing.chunker import chunk_blocks
from src.rag.models.document import DocumentChunk

def save_chunks(chunks: List[DocumentChunk], output_dir: str, file_name: str):
    """Saves chunks to a JSON file."""
    os.makedirs(output_dir, exist_ok=True)
    out_path = os.path.join(output_dir, f"{file_name}.json")
    
    with open(out_path, "w", encoding="utf-8") as f:
        json_data = [chunk.model_dump() for chunk in chunks]
        json.dump(json_data, f, indent=2)

def run_pipeline(source_dir: str, output_dir: str):
    print(f"Starting ingestion pipeline from {source_dir} to {output_dir}")
    
    stats = {
        "pdfs_found": 0,
        "jsons_found": 0,
        "docs_success": 0,
        "docs_failed": 0,
        "total_chunks": 0,
        "categories": set(),
        "mitre_objects": 0,
        "failed_files": []
    }
    
    for root, dirs, files in os.walk(source_dir):
        for f in files:
            if f == ".DS_Store":
                continue
                
            file_path = os.path.join(root, f)
            ext = os.path.splitext(f)[1].lower()
            
            try:
                if ext == ".pdf":
                    stats["pdfs_found"] += 1
                    doc_hash = get_pdf_hash(file_path)
                    metadata = generate_metadata_from_path(file_path, doc_hash)
                    stats["categories"].add(metadata.category)
                    
                    raw_blocks, _ = process_pdf(file_path)
                    chunks = chunk_blocks(raw_blocks, metadata)
                    
                    save_chunks(chunks, output_dir, f"{f}_{doc_hash[:8]}")
                    
                    stats["docs_success"] += 1
                    stats["total_chunks"] += len(chunks)
                    
                elif ext == ".json":
                    stats["jsons_found"] += 1
                    doc_hash = get_mitre_hash(file_path)
                    metadata = generate_metadata_from_path(file_path, doc_hash)
                    stats["categories"].add(metadata.category)
                    
                    chunks = process_mitre_json(file_path, metadata)
                    
                    save_chunks(chunks, output_dir, f"{f}_{doc_hash[:8]}")
                    
                    stats["docs_success"] += 1
                    stats["total_chunks"] += len(chunks)
                    stats["mitre_objects"] += len(chunks)
                    
            except Exception as e:
                print(f"Failed to process {file_path}: {e}")
                stats["docs_failed"] += 1
                stats["failed_files"].append(file_path)
                
    print("\n--- Corpus Inspection Report ---")
    print(f"PDFs discovered: {stats['pdfs_found']}")
    print(f"JSONs discovered: {stats['jsons_found']}")
    print(f"Documents successfully processed: {stats['docs_success']}")
    print(f"Documents failed: {stats['docs_failed']}")
    print(f"Approximate chunks produced: {stats['total_chunks']}")
    print(f"MITRE objects extracted: {stats['mitre_objects']}")
    print(f"Categories discovered: {', '.join(stats['categories'])}")
    if stats["failed_files"]:
        print("Failed files:")
        for ff in stats["failed_files"]:
            print(f"  - {ff}")
            
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Phase 4A Document Ingestion Pipeline")
    parser.add_argument("--source", type=str, default="knowledge", help="Source directory containing documents")
    parser.add_argument("--output", type=str, default="data/processed", help="Output directory for processed chunks")
    args = parser.parse_args()
    
    run_pipeline(args.source, args.output)
