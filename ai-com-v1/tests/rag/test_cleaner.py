import pytest
from src.rag.preprocessing.cleaner import is_toc_content, is_appendix_header

def test_is_toc_content():
    assert is_toc_content("1. Introduction ......... 5\n2. Background ......... 10") is True
    assert is_toc_content("1.1 Scope   15\n1.2 Context   17") is True
    assert is_toc_content("This is a normal paragraph about some technical concept.") is False
    assert is_toc_content("Just a single line") is False

def test_is_appendix_header():
    assert is_appendix_header("Appendix A: Network Architecture") is True
    assert is_appendix_header("APPENDIX B") is True
    assert is_appendix_header("1. Appendix Usage") is False
