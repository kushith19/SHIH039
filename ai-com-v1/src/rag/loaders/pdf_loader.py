import pymupdf as fitz  # PyMuPDF
import hashlib
import re
from typing import List, Dict, Any, Tuple
from src.rag.preprocessing.cleaner import remove_headers_footers, is_toc_content, clean_block_text

def get_file_hash(file_path: str) -> str:
    """Generates a SHA-256 hash of a file."""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def _extract_font_features(span: Dict[str, Any]) -> Dict[str, Any]:
    """Extracts font size and weight from a text span."""
    font = span.get("font", "").lower()
    size = span.get("size", 10.0)
    flags = span.get("flags", 0)
    
    # In PyMuPDF, flag bit 4 (value 16) usually means bold
    is_bold = "bold" in font or "black" in font or "heavy" in font or (flags & 16) != 0
    return {"size": round(size, 1), "is_bold": is_bold}

def _is_heading(text: str, features: Dict[str, Any], avg_size: float) -> bool:
    """
    Uses multiple signals to determine if a text block is a heading:
    - Font size relative to average
    - Font weight (bold)
    - Numbering patterns (e.g., '1.2.3 Section')
    - Short length (headings aren't usually huge paragraphs)
    """
    if len(text) > 200 or len(text.split()) > 25:
        return False  # Too long to be a normal heading
        
    size = features.get("size", 10.0)
    is_bold = features.get("is_bold", False)
    
    is_numbered = bool(re.match(r'^(?:[A-Z]\.?|\d+(?:\.\d+)*)\s+[A-Z]', text))
    
    size_ratio = size / avg_size if avg_size > 0 else 1.0
    
    # Signals
    if size_ratio > 1.2:
        return True
    if size_ratio >= 1.0 and is_bold and (is_numbered or len(text) < 100):
        return True
        
    return False

def process_pdf(file_path: str) -> Tuple[List[Dict[str, Any]], str]:
    """
    Extracts text blocks from a PDF using layout awareness.
    Returns a list of structured blocks and the document hash.
    """
    doc_hash = get_file_hash(file_path)
    doc = fitz.open(file_path)
    
    raw_blocks = []
    
    # First pass: collect all text sizes to find the "normal" body text size
    sizes = []
    for page in doc:
        blocks = page.get_text("dict").get("blocks", [])
        for b in blocks:
            if b.get("type") == 0:  # Text block
                for line in b.get("lines", []):
                    for span in line.get("spans", []):
                        sizes.append(span.get("size", 10.0))
                        
    if not sizes:
        return [], doc_hash
        
    # Simple mode approximation for average text size
    avg_size = max(set(sizes), key=sizes.count)
    
    for page_num, page in enumerate(doc, start=1):
        page_height = page.rect.height
        blocks = page.get_text("dict").get("blocks", [])
        
        page_blocks = []
        for b in blocks:
            if b.get("type") == 0:  # Text block
                text = ""
                main_features = {"size": 0.0, "is_bold": False}
                max_size = 0.0
                
                for line in b.get("lines", []):
                    for span in line.get("spans", []):
                        span_text = span.get("text", "")
                        text += span_text
                        
                        f = _extract_font_features(span)
                        if f["size"] > max_size:
                            max_size = f["size"]
                            main_features = f
                            
                    text += "\n"
                    
                text = clean_block_text(text)
                if not text:
                    continue
                    
                page_blocks.append({
                    "text": text,
                    "bbox": b.get("bbox"),
                    "features": main_features,
                    "page_number": page_num
                })
                
        # Clean headers/footers for this page
        cleaned_blocks = remove_headers_footers(page_blocks, page_height)
        
        # Analyze blocks and mark headings
        for b in cleaned_blocks:
            text = b["text"]
            
            # Skip if it's confidently a TOC block
            if is_toc_content(text):
                continue
                
            b["is_heading"] = _is_heading(text, b["features"], avg_size)
            raw_blocks.append(b)
            
    doc.close()
    return raw_blocks, doc_hash
