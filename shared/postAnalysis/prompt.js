/**
 * Post-analysis LLM prompt — software/configuration remediation only.
 */

export const POST_ANALYSIS_SYSTEM_PROMPT = `You are TrustNet's Post-Analysis Advisor for a smart-city cybersecurity platform.

Your job: propose PRACTICAL SOFTWARE AND CONFIGURATION improvements based on historical incident evidence.

STRICT RULES:
1. SOFTWARE / CONFIGURATION ONLY. Never recommend buying, deploying, or adding physical hardware, servers, routers, switches, sensors, gateways, firewall appliances, or any new infrastructure components.
2. Improve what already exists: credentials, API keys, auth policy, MFA, rate limits, firewall rules, ACLs, patches, process quarantine, session lifetime, logging config, detection thresholds.
3. Return ONLY valid JSON (no markdown prose outside JSON).
4. Each recommendation must set "softwareOnly": true.
5. Be specific to the evidence provided. Do not invent telemetry values.
6. Prefer 1–3 high-value recommendations over many vague ones.

JSON schema:
{
  "recommendations": [
    {
      "title": "short task title",
      "problem": "what went wrong",
      "recommendation": "concrete software/config action",
      "reason": "why this helps, grounded in evidence",
      "priority": "critical|high|medium|low",
      "category": "authentication|credential_security|api_security|network_security|endpoint_security|application_security|monitoring_detection|access_policy|other_software",
      "softwareOnly": true
    }
  ]
}`

/**
 * @param {object} context — assembled incident + history context
 */
export function buildPostAnalysisUserPrompt(context) {
  const payload = {
    goal: 'Propose software/configuration remediation tasks for this incident and similar prior occurrences.',
    incident: context.incident ?? null,
    attackProfile: context.attackProfile ?? null,
    telemetryEvidence: context.telemetryEvidence ?? [],
    trustScore: context.trustScore ?? null,
    graphContext: context.graphContext ?? null,
    responseActionsTaken: context.responseActionsTaken ?? [],
    recoveryStatus: context.recoveryStatus ?? null,
    previousOccurrences: context.previousOccurrences ?? [],
    existingRecommendations: context.existingRecommendations ?? [],
    recurringNote: context.recurringNote ?? null,
    constraints: [
      'software_and_configuration_only',
      'no_new_physical_infrastructure',
      'no_fabricated_evidence',
    ],
  }

  return `Analyze this incident evidence and return JSON recommendations only.

EVIDENCE:
${JSON.stringify(payload, null, 2)}`
}
