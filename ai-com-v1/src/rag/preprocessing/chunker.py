import hashlib
from typing import List, Dict, Any, Optional
from src.rag.models.document import DocumentChunk, DocumentMetadata

def _generate_chunk_id(doc_hash: str, section: str, index: int) -> str:
    """Generates a deterministic chunk ID."""
    raw = f"{doc_hash}_{section}_{index}".encode('utf-8')
    return hashlib.sha256(raw).hexdigest()

def chunk_blocks(blocks: List[Dict[str, Any]], metadata: DocumentMetadata, max_chunk_size: int = 1500) -> List[DocumentChunk]:
    """
    Groups structured text blocks into chunks, respecting section boundaries.
    `blocks` is a list of dictionaries with keys:
      - 'text'
      - 'is_heading'
      - 'page_number'
    """
    chunks = []
    current_section = "Document Start"
    current_text = ""
    current_page = None
    chunk_index = 0
    
    def finish_chunk():
        nonlocal current_text, chunk_index
        if current_text.strip():
            chunk_id = _generate_chunk_id(metadata.document_hash, current_section, chunk_index)
            chunks.append(DocumentChunk(
                chunk_id=chunk_id,
                text=current_text.strip(),
                metadata=metadata,
                section=current_section,
                page_number=current_page
            ))
            chunk_index += 1
            current_text = ""
            
    for block in blocks:
        text = block.get('text', '').strip()
        if not text:
            continue
            
        is_heading = block.get('is_heading', False)
        page_num = block.get('page_number')
        
        # If we hit a new heading, finish the current chunk and update the section
        if is_heading:
            finish_chunk()
            current_section = text
            if current_page is None:
                current_page = page_num
            # We can optionally include the heading text in the new chunk or just rely on the section metadata.
            # Including it helps local context if the chunk stands alone.
            current_text = text + "\n\n"
        else:
            if current_page is None:
                current_page = page_num
                
            # If adding this block exceeds max_chunk_size, finish the current chunk first
            if len(current_text) + len(text) > max_chunk_size and len(current_text) > 0:
                finish_chunk()
                current_page = page_num
                
            current_text += text + "\n\n"
            
    finish_chunk()
    
    return chunks
