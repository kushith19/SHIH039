import re
from typing import List, Dict, Any

def is_toc_content(text: str) -> bool:
    """
    Conservatively checks if text looks purely like a Table of Contents entry.
    Checks for typical patterns like trailing dots followed by numbers.
    """
    lines = text.strip().split('\n')
    if not lines:
        return False
    
    toc_lines = 0
    for line in lines:
        line = line.strip()
        # Look for typical TOC patterns: "Some Title ........... 12"
        if re.search(r'\.{3,}\s*\d+$', line) or re.search(r'\.\s*\.\s*\.\s*\d+$', line):
            toc_lines += 1
        elif re.match(r'^(?:\d+\.)+\d*\s+.*\s+\d+$', line):
            # E.g. "1.1.2 Some section name 45"
            toc_lines += 1
            
    # Consider it TOC only if a significant portion of lines match the pattern
    return toc_lines > 0 and (toc_lines / len(lines) > 0.5)

def is_appendix_header(text: str) -> bool:
    """
    Checks if a heading is an appendix. We won't blindly drop it, but we might want to flag it.
    """
    return bool(re.match(r'^appendix\s+[a-z0-9]', text.strip().lower()))

def clean_block_text(text: str) -> str:
    """
    Cleans general whitespace issues in a block of text.
    """
    # Replace multiple spaces with a single space, but keep newlines for structure
    # Though PyMuPDF blocks usually have single spaces.
    return text.strip()

def remove_headers_footers(blocks: List[Dict[str, Any]], page_height: float, margin_threshold: float = 0.08) -> List[Dict[str, Any]]:
    """
    Removes blocks that are clearly headers or footers based on their position (top or bottom % of page)
    and if they look like page numbers or repeated titles.
    """
    cleaned_blocks = []
    top_margin = page_height * margin_threshold
    bottom_margin = page_height * (1.0 - margin_threshold)
    
    for block in blocks:
        # block contains 'bbox' (x0, y0, x1, y1), 'text', etc.
        y0, y1 = block.get("bbox", (0, 0, 0, 0))[1], block.get("bbox", (0, 0, 0, 0))[3]
        text = block.get("text", "").strip()
        
        # If it's just a page number at the top or bottom
        if (y1 < top_margin or y0 > bottom_margin) and re.match(r'^(?:page\s*)?\d+$', text.lower()):
            continue
            
        # If it's small text strictly at the very top/bottom, might be a header/footer
        # but we need to be conservative. We will just remove pure page numbers for now
        # and very obvious single-line headers that are identical across pages (hard to do without cross-page state).
        
        cleaned_blocks.append(block)
        
    return cleaned_blocks
