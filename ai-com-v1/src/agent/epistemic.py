"""Split observed / retrieved / inference text for Commander prompts."""

EPISTEMIC_RULES = """
EPISTEMIC BUCKETS (do not mix):
- observedEvidence: copy Level-1 detector facts only (metric, observed, expected, deviationPct, trust).
- graphContext: neighbors, hops, catalog edges, spread roles already in the input. Do not invent hops.
- citations: retrieved knowledge (NIST, MITRE, CERT-In, NCIIPC) — guidance, not proof of an attack.
- inference: conclusions that combine observed facts with guidance.
- uncertainties / hypothesis: candidate techniques and unproven explanations. Use "candidate", "potentially consistent with", "requires verification".

Never say an attacker executed a MITRE technique unless Level-1 evidence proves it.
If retrieved knowledge is empty, set knowledgeStatus to unavailable and do not invent citations.
"""
