import pytest
from src.rag.loaders.pdf_loader import _is_heading, _extract_font_features

def test_extract_font_features():
    span_regular = {"font": "Helvetica", "size": 10.5, "flags": 0}
    f1 = _extract_font_features(span_regular)
    assert f1["size"] == 10.5
    assert f1["is_bold"] is False
    
    span_bold = {"font": "Helvetica-Bold", "size": 12.0, "flags": 16}
    f2 = _extract_font_features(span_bold)
    assert f2["size"] == 12.0
    assert f2["is_bold"] is True

def test_is_heading():
    # Regular text, same size as avg
    assert _is_heading("Just a normal paragraph text that goes on for a bit.", {"size": 10.0, "is_bold": False}, 10.0) is False
    
    # Large text
    assert _is_heading("Main Title", {"size": 18.0, "is_bold": True}, 10.0) is True
    
    # Numbered bold text, same size
    assert _is_heading("1.1 Introduction", {"size": 10.0, "is_bold": True}, 10.0) is True
    
    # Numbered but not bold, not larger
    assert _is_heading("1.1 Some item", {"size": 10.0, "is_bold": False}, 10.0) is False
    
    # Bold but too long to be a heading
    long_text = "This is a very long text that happens to be bold but it contains way too many words to reasonably be considered a heading in any standard document so we should reject it as a heading."
    assert _is_heading(long_text, {"size": 10.0, "is_bold": True}, 10.0) is False
