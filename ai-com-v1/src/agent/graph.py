import json
import logging
import time
from typing import TypedDict, Dict, Any, Optional, List

from langgraph.graph import StateGraph, START, END
from langchain_core.messages import SystemMessage, HumanMessage
from pydantic import ValidationError

from src.models.detection import DetectionInput, CampaignInput
from src.models.commander import CommanderResponse
from src.agent.models import RetrievalPlan, RetrievedEvidence, RetrievalQuery, RetrievalPriority, EvidenceSufficiency
from src.agent.llm_provider import get_llm_provider
from src.agent.prompts import COMMANDER_SYSTEM_PROMPT, QUERY_PLANNER_PROMPT, EVIDENCE_SUFFICIENCY_PROMPT

logger = logging.getLogger(__name__)

MISSING_DOMAIN_TO_CATEGORY = {
    "anomaly_behavior": "attack-intelligence",
    "infrastructure_domain": "smart-city",
    "incident_response": "incident-response",
    "ot_ics": "ot-ics",
    "smart_city": "smart-city",
    "resilience": "resilience",
    "india": "india",
}

class AgentState(TypedDict):
    analysis_mode: str
    incident_input: Optional[DetectionInput]
    campaign_input: Optional[CampaignInput]
    retrieval_plan: Optional[RetrievalPlan]
    retrieved_evidence: Optional[List[RetrievedEvidence]]
    retrieval_status: Optional[str]  # 'success', 'partial', 'unavailable'
    raw_llm_output: Optional[str]
    commander_response: Optional[CommanderResponse]
    error: Optional[str]
    correction_attempts: Optional[int]
    validation_errors: Optional[str]
    
    evidence_sufficiency: Optional[EvidenceSufficiency]
    targeted_retrieval_used: bool
    missing_domains: list[str]
    additional_chunks_retrieved: int

    # Provider Metrics
    llm_provider: Optional[str]
    llm_model: Optional[str]
    provider_fallback_used: Optional[bool]
    provider_fallback_reason: Optional[str]

    # Metrics
    correction_latency_ms: Optional[float]
    planning_latency_ms: Optional[float]
    retrieval_latency_ms: Optional[float]
    assessment_latency_ms: Optional[float]
    sufficiency_latency_ms: Optional[float]
    targeted_retrieval_latency_ms: Optional[float]
    safety_validation_latency_ms: Optional[float]
    safety_correction_latency_ms: Optional[float]
    
    # Phase 5B Metrics
    sufficiency_llm_invoked: Optional[bool]
    deterministic_bypass_reason: Optional[str]
    llm_call_count: Optional[int]
    evidence_context_size: Optional[int]
    final_evidence_count: Optional[int]

    # Phase 5C Metrics
    planner_mode: Optional[str]
    planner_bypass_reason: Optional[str]

def extract_provider_metrics(response) -> dict:
    if response is None:
        return {}
    meta = getattr(response, "response_metadata", None) or {}
    updates = {}
    if "provider" in meta:
        updates["llm_provider"] = meta.get("provider")
    if "model_name" in meta:
        updates["llm_model"] = meta.get("model_name")
    elif "model" in meta:
        updates["llm_model"] = meta.get("model")
    if meta.get("provider_fallback_used"):
        updates["provider_fallback_used"] = True
        updates["provider_fallback_reason"] = meta.get("provider_fallback_reason")
    return updates

def get_incident_summary(state: AgentState):
    if state.get("analysis_mode") == "campaign":
        camp = state["campaign_input"]
        endpoints = set()
        det_types = set()
        for inc in camp.incidents:
            endpoints.update(inc.affected_endpoints)
            det_types.add(inc.detection_type.value)
        endpoints_str = " ".join(endpoints)
        types_str = " ".join(det_types)
        incident_desc = f"campaign {camp.campaign_type} {str(camp.metadata)} {endpoints_str} {types_str}".lower()
        base_term = " ".join(det_types).replace('_', ' ')
        endpoints_term = endpoints_str
        is_complex = True # campaigns are inherently complex
        log_id = camp.campaign_id
        input_dump = camp.model_dump_json(indent=2)
    else:
        det = state["incident_input"]
        incident_desc = f"{det.detection_type.value} {str(det.metadata)} {' '.join(det.affected_endpoints)}".lower()
        base_term = str(det.detection_type.value).replace('_', ' ')
        endpoints_term = " ".join(det.affected_endpoints)
        # New Complexity Rules
        has_ot = any(k in incident_desc for k in ["water", "traffic", "control", "scada", "plc", "ot", "ics", "substation"])
        has_it = any(k in incident_desc for k in ["smart", "municipal", "city", "auth", "server", "cloud"])
        has_fusion = "fusion" in str(det.metadata).lower() or "correlat" in incident_desc or "cross-sector" in incident_desc
        
        is_complex = False
        if len(det.affected_endpoints) >= 4:
            is_complex = True
        elif has_fusion:
            is_complex = True
        elif has_ot and has_it:
            is_complex = True
            
        log_id = det.incident_id
        input_dump = det.model_dump_json(indent=2)
    return incident_desc, base_term, endpoints_term, is_complex, log_id, input_dump

def generate_retrieval_plan(state: AgentState) -> AgentState:
    t0 = time.perf_counter()
    incident_desc, base_term, endpoints_term, is_complex, log_id, input_dump = get_incident_summary(state)
    logger.info(f"Generating retrieval plan for {log_id}")
    
    # Phase 5C: Safe Deterministic Query Planning
    if not is_complex:
        domains = ["incident-response"]
        if any(k in incident_desc for k in ["water", "traffic", "control", "scada", "plc", "ot", "ics", "substation"]):
            domains.append("ot-ics")
        if any(k in incident_desc for k in ["smart", "municipal", "city", "auth", "server", "cloud"]):
            domains.append("smart-city")
        if "india" in incident_desc or "cigu" in incident_desc or "nciipc" in incident_desc:
            domains.append("india")
            
        queries = []
        
        queries.append(RetrievalQuery(
            query=f"{base_term} {endpoints_term}",
            rationale="Deterministic query for primary detection",
            priority=RetrievalPriority.HIGH
        ))
        
        for d in domains:
            queries.append(RetrievalQuery(
                query=f"{base_term} {d}",
                rationale=f"Deterministic query for domain: {d}",
                priority=RetrievalPriority.MEDIUM
            ))
            
        plan = RetrievalPlan(queries=queries[:4])
        t1 = time.perf_counter()
        plan_lat = (t1-t0)*1000
        
        logger.info(f"Deterministic planner bypassed LLM. Queries: {len(plan.queries)}")
        return {
            "retrieval_plan": plan, 
            "planning_latency_ms": plan_lat,
            "planner_mode": "deterministic",
            "planner_bypass_reason": "Single-domain or simple incident",
            "llm_call_count": state.get("llm_call_count", 0)
        }
    
    try:
        provider = get_llm_provider()
        llm = provider.get_model()
        
        messages = [
            SystemMessage(content=QUERY_PLANNER_PROMPT),
            HumanMessage(content=f"Detection Event Details:\n{input_dump}\n\n"
                                 f"You MUST provide your assessment as a JSON object matching this exact JSON Schema:\n"
                                 f"{json.dumps(RetrievalPlan.model_json_schema(), indent=2)}\n\n"
                                 f"Do not include markdown wrapping or extraneous text.")
        ]
        
        if hasattr(llm, "bind"):
            llm = llm.bind(format="json")
            
        response = llm.invoke(messages)
        current_llm_calls = state.get("llm_call_count", 0)
        new_llm_calls = current_llm_calls + 1
        
        # Parse output
        raw_output = response.content.strip()
        if raw_output.startswith("```json"):
            raw_output = raw_output[7:]
        if raw_output.startswith("```"):
            raw_output = raw_output[3:]
        if raw_output.endswith("```"):
            raw_output = raw_output[:-3]
            
        parsed_json = json.loads(raw_output.strip())
        plan = RetrievalPlan(**parsed_json)
        
        # Enforce max 4 queries
        if len(plan.queries) > 4:
            plan.queries = plan.queries[:4]
            
        t1 = time.perf_counter()
        plan_lat = (t1-t0)*1000
        logger.info(f"RetrievalPlan Generated: {len(plan.queries)} queries in {plan_lat:.2f}ms")
        for i, q in enumerate(plan.queries):
            cat_str = q.category.value if q.category else "None"
            prio_str = q.priority.value if q.priority else "None"
            logger.info(f"  - Query {i+1}: '{q.query}' (Category: {cat_str}, Priority: {prio_str})")
        
        return {
            "retrieval_plan": plan, 
            "planning_latency_ms": plan_lat, 
            "llm_call_count": new_llm_calls,
            "planner_mode": "llm",
            "planner_bypass_reason": None,
            **extract_provider_metrics(response)
        }
        
    except (json.JSONDecodeError, ValidationError) as e:
        logger.error(f"Query planning validation failed: {e}. Falling back to default query.")
    except Exception as e:
        logger.error(f"LLM query planning failed: {e}. Falling back to default query.")
        
    # Fallback plan
    fallback_query = RetrievalQuery(
        query=base_term,
        rationale="Fallback query derived directly from detection type.",
        priority=RetrievalPriority.HIGH
    )
    fallback_plan = RetrievalPlan(queries=[fallback_query])
    t1 = time.perf_counter()
    plan_lat = (t1-t0)*1000
    
    logger.info(f"RetrievalPlan Generated (Fallback): 1 queries in {plan_lat:.2f}ms")
    logger.info(f"  - Query 1: '{fallback_query.query}' (Category: None, Priority: {fallback_query.priority.value})")
    
    return {
        "retrieval_plan": fallback_plan, 
        "planning_latency_ms": plan_lat,
        "planner_mode": "fallback",
        "planner_bypass_reason": "LLM failed"
    }

# Note: The retrieve_knowledge node will be dynamically injected or will pull from app state 
# We'll create a factory function to inject the retriever into the node logic.

def build_retrieve_knowledge_node(retriever):
    def retrieve_knowledge(state: AgentState) -> AgentState:
        logger.info("Executing retrieval plan")
        t0 = time.perf_counter()
        plan = state.get("retrieval_plan")
        
        if not plan or not plan.queries:
            return {"retrieval_status": "unavailable", "retrieved_evidence": [], "retrieval_latency_ms": 0.0}
            
        all_evidence: Dict[str, RetrievedEvidence] = {}
        
        for q in plan.queries:
            logger.debug(f"Executing query: '{q.query}' (Cat: {q.category})")
            filters = {}
            if q.category:
                filters["category"] = q.category.value
            if q.source:
                filters["source"] = q.source
                
            try:
                result = retriever.retrieve(q.query, top_k=3, filters=filters if filters else None)
                logger.info(f"  - Query '{q.query}': returned {len(result.results)} chunks")
                for chunk in result.results:
                    if chunk.chunk_id in all_evidence:
                        # Deduplicate, just append the query that found it
                        if q.query not in all_evidence[chunk.chunk_id].retrieval_queries:
                            all_evidence[chunk.chunk_id].retrieval_queries.append(q.query)
                    else:
                        evidence = RetrievedEvidence(
                            retrieval_queries=[q.query],
                            score=chunk.score,
                            source=chunk.source,
                            document_name=chunk.document_name,
                            category=chunk.category,
                            section=chunk.section,
                            page_number=chunk.page_number,
                            chunk_id=chunk.chunk_id,
                            text=chunk.text
                        )
                        all_evidence[chunk.chunk_id] = evidence
            except Exception as e:
                logger.error(f"Retrieval failed for query '{q.query}': {e}")
                
        final_evidence = list(all_evidence.values())
        if not final_evidence:
            return {"retrieval_status": "unavailable", "retrieved_evidence": [], "retrieval_latency_ms": (time.perf_counter()-t0)*1000}
            
        # Diversity logic
        highest_score = max(ev.score for ev in final_evidence)
        threshold = highest_score * 0.90
        
        competitive = []
        weak = []
        for ev in final_evidence:
            if ev.score >= threshold:
                competitive.append(ev)
            else:
                weak.append(ev)
        
        # Group competitive candidates by (category, document_name)
        from collections import defaultdict
        groups = defaultdict(list)
        for ev in competitive:
            groups[(ev.category, ev.document_name)].append(ev)
            
        for g in groups.values():
            g.sort(key=lambda x: x.score, reverse=True)
            
        selected_evidence = []
        group_keys = list(groups.keys())
        # Sort groups by their best score
        group_keys.sort(key=lambda k: groups[k][0].score, reverse=True)
        
        while group_keys and len(selected_evidence) < 10:
            for k in list(group_keys):
                if groups[k]:
                    selected_evidence.append(groups[k].pop(0))
                    if len(selected_evidence) >= 10:
                        break
                else:
                    group_keys.remove(k)
                    
        # Add from weak if space remains
        if len(selected_evidence) < 10 and weak:
            weak.sort(key=lambda x: x.score, reverse=True)
            selected_evidence.extend(weak[:10 - len(selected_evidence)])
        
        t1 = time.perf_counter()
        retrieval_lat = (t1-t0)*1000
        
        status = "success" if selected_evidence else "unavailable"
        if len(selected_evidence) < len(plan.queries): 
            # Very loose definition of partial, but sufficient for V1
            status = "partial" if selected_evidence else "unavailable"
            
        logger.info(f"Retrieval Status: {status}")
        logger.info(f"Total Unique/Deduplicated Chunks: {len(selected_evidence)}")
        source_names = [f"{ev.source}/{ev.document_name}" for ev in selected_evidence]
        unique_source_names = list(set(source_names))
        logger.info(f"Sources/Documents Retrieved: {', '.join(unique_source_names) if unique_source_names else 'None'}")
            
        return {
            "retrieved_evidence": selected_evidence,
            "retrieval_status": status,
            "retrieval_latency_ms": retrieval_lat
        }
    return retrieve_knowledge

def assess_evidence_sufficiency(state: AgentState) -> AgentState:
    logger.info("Assessing evidence sufficiency")
    t0 = time.perf_counter()
    
    try:
        evidence_list = state.get("retrieved_evidence", [])
        
        # --- DETERMINISTIC BYPASS LOGIC ---
        import os
        SUFFICIENCY_MIN_EVIDENCE = int(os.getenv("SUFFICIENCY_MIN_EVIDENCE", "3"))
        SUFFICIENCY_MIN_SCORE = float(os.getenv("SUFFICIENCY_MIN_SCORE", "0.50"))
        SUFFICIENCY_MIN_CATEGORIES = int(os.getenv("SUFFICIENCY_MIN_CATEGORIES", "2"))
        
        if not evidence_list:
            logger.info("Sufficiency Bypass Triggered: ZERO usable evidence. Routing to targeted retrieval.")
            sufficiency = EvidenceSufficiency(sufficient=False, confidence=1.0, missing_domains=["incident_response"], rationale="Zero evidence retrieved.")
            return {
                "evidence_sufficiency": sufficiency, 
                "missing_domains": ["incident_response"],
                "sufficiency_latency_ms": (time.perf_counter()-t0)*1000,
                "targeted_retrieval_used": False,
                "additional_chunks_retrieved": 0,
                "sufficiency_llm_invoked": False,
                "deterministic_bypass_reason": "Zero evidence retrieved",
                **extract_provider_metrics(None)
            }
            
        if len(evidence_list) >= SUFFICIENCY_MIN_EVIDENCE:
            max_score = max(ev.score for ev in evidence_list) if evidence_list else 0
            unique_cats = set(ev.category for ev in evidence_list)
            unique_docs = set(ev.document_name for ev in evidence_list)
            
            diversity_ok = len(unique_docs) >= 2 if len(unique_cats) > 1 else len(unique_docs) >= 1
            
            if max_score >= SUFFICIENCY_MIN_SCORE and len(unique_cats) >= SUFFICIENCY_MIN_CATEGORIES and diversity_ok:
                incident_desc, _, _, is_complex, _, _ = get_incident_summary(state)
                
                required_domains = set(["incident-response"])
                
                if any(k in incident_desc for k in ["water", "traffic", "control", "scada", "plc", "ot", "ics", "substation"]):
                    required_domains.add("ot-ics")
                if any(k in incident_desc for k in ["smart", "municipal", "city", "auth", "server", "cloud"]):
                    required_domains.add("smart-city")
                
                covered = all(req in unique_cats for req in required_domains)
                
                if covered and not is_complex:
                    bypass_reason = f"max_score={max_score:.2f}, {len(unique_cats)} cats, {len(unique_docs)} docs, covers {required_domains}"
                    logger.info(f"Sufficiency Bypass Triggered: {bypass_reason}")
                    sufficiency = EvidenceSufficiency(sufficient=True, confidence=1.0, missing_domains=[], rationale=f"Deterministic bypass: {bypass_reason}")
                    return {
                        "evidence_sufficiency": sufficiency, 
                        "missing_domains": [],
                        "sufficiency_latency_ms": (time.perf_counter()-t0)*1000,
                        "targeted_retrieval_used": False,
                        "additional_chunks_retrieved": 0,
                        "sufficiency_llm_invoked": False,
                        "deterministic_bypass_reason": bypass_reason,
                        **extract_provider_metrics(None)
                    }
        # --- END BYPASS LOGIC ---

        provider = get_llm_provider()
        llm = provider.get_model()
        
        evidence_blocks = []
        for idx, ev in enumerate(evidence_list, 1):
            block = f"[Source: {ev.source} | Doc: {ev.document_name} | Cat: {ev.category}]\n{ev.text}"
            evidence_blocks.append(block)
        evidence_text = "\n\n".join(evidence_blocks) if evidence_blocks else "No authoritative evidence available."
            
        _, _, _, _, _, input_dump = get_incident_summary(state)
        messages = [
            SystemMessage(content=EVIDENCE_SUFFICIENCY_PROMPT),
            HumanMessage(content=f"Detection Event Details:\n{input_dump}\n\n"
                                 f"Retrieved Authoritative Evidence:\n{evidence_text}\n\n"
                                 f"You MUST provide your assessment as a JSON object matching this exact JSON Schema:\n"
                                 f"{json.dumps(EvidenceSufficiency.model_json_schema(), indent=2)}")
        ]
        
        if hasattr(llm, "bind"):
            llm = llm.bind(format="json")
            
        response = llm.invoke(messages)
        
        raw_output = response.content.strip()
        if raw_output.startswith("```json"):
            raw_output = raw_output[7:]
        if raw_output.startswith("```"):
            raw_output = raw_output[3:]
        if raw_output.endswith("```"):
            raw_output = raw_output[:-3]
            
        parsed_json = json.loads(raw_output.strip())
        sufficiency = EvidenceSufficiency(**parsed_json)
        
        t1 = time.perf_counter()
        lat = (t1-t0)*1000
        
        missing_domains = [d.value for d in sufficiency.missing_domains]
        
        logger.info(f"Sufficiency Assessment: {sufficiency.sufficient} in {lat:.2f}ms")
        logger.info(f"Missing Domains: {missing_domains}")
        
        return {
            "evidence_sufficiency": sufficiency, 
            "missing_domains": missing_domains,
            "sufficiency_latency_ms": lat,
            "targeted_retrieval_used": False,
            "additional_chunks_retrieved": 0,
            "sufficiency_llm_invoked": True,
            "llm_call_count": state.get("llm_call_count", 0) + 1,
            **extract_provider_metrics(response)
        }
        
    except Exception as e:
        logger.error(f"Sufficiency assessment failed: {e}")
        # Default to sufficient to avoid breaking the flow if LLM fails
        sufficiency = EvidenceSufficiency(sufficient=True, confidence=0.0, missing_domains=[], rationale="Fallback due to error")
        return {
            "evidence_sufficiency": sufficiency, 
            "missing_domains": [],
            "sufficiency_latency_ms": (time.perf_counter()-t0)*1000,
            "targeted_retrieval_used": False,
            "additional_chunks_retrieved": 0
        }

def build_targeted_retrieval_node(retriever):
    def targeted_retrieval(state: AgentState) -> AgentState:
        logger.info("Executing targeted retrieval")
        t0 = time.perf_counter()
        
        # Enforce ONE pass limit
        if state.get("targeted_retrieval_used"):
            return {"targeted_retrieval_latency_ms": 0.0}
        
        missing = state.get("missing_domains", [])
        if not missing:
            return {"targeted_retrieval_used": True, "additional_chunks_retrieved": 0, "targeted_retrieval_latency_ms": 0.0}
            
        # Construct up to 2 deterministic queries
        queries = []
        cats = [
            MISSING_DOMAIN_TO_CATEGORY.get(str(d), str(d).replace("_", "-"))
            for d in missing[:2]
        ]
        domain_str = " ".join(c.replace("-", " ") for c in cats)
        _, base_term, _, _, _, _ = get_incident_summary(state)
        queries.append(f"{base_term} {domain_str}")
        
        if len(cats) > 1:
            queries.append(f"incident response {cats[1].replace('-', ' ')}")
            
        current_evidence = state.get("retrieved_evidence", [])
        existing_ids = {ev.chunk_id for ev in current_evidence}
        
        new_evidence = []
        for q in queries[:2]:
            try:
                result = retriever.retrieve(q, top_k=2)
                for chunk in result.results:
                    if chunk.chunk_id not in existing_ids:
                        evidence = RetrievedEvidence(
                            retrieval_queries=[f"Targeted: {q}"],
                            score=chunk.score,
                            source=chunk.source,
                            document_name=chunk.document_name,
                            category=chunk.category,
                            section=chunk.section,
                            page_number=chunk.page_number,
                            chunk_id=chunk.chunk_id,
                            text=chunk.text
                        )
                        new_evidence.append(evidence)
                        existing_ids.add(chunk.chunk_id)
            except Exception as e:
                logger.error(f"Targeted retrieval failed for query '{q}': {e}")
                
        # Append new evidence and cap at 10 total
        combined = current_evidence + new_evidence
        combined.sort(key=lambda x: x.score, reverse=True)
        combined = combined[:10]
        
        t1 = time.perf_counter()
        lat = (t1-t0)*1000
        
        logger.info(f"Targeted retrieval added {len(new_evidence)} chunks in {lat:.2f}ms")
        
        return {
            "retrieved_evidence": combined,
            "targeted_retrieval_used": True,
            "additional_chunks_retrieved": len(new_evidence),
            "targeted_retrieval_latency_ms": lat
        }
    return targeted_retrieval

def generate_assessment(state: AgentState) -> AgentState:
    _, _, _, _, log_id, input_dump = get_incident_summary(state)
    logger.info(f"Generating assessment for {log_id}")
    t0 = time.perf_counter()
    
    try:
        provider = get_llm_provider()
        llm = provider.get_model()
        
        evidence_text = "No authoritative evidence available."
        status = state.get("retrieval_status", "unavailable")
        evidence_list = state.get("retrieved_evidence", [])
        
        if status in ["success", "partial"] and evidence_list:
            evidence_blocks = []
            seen_texts = set()
            for ev in evidence_list:
                if ev.text not in seen_texts:
                    seen_texts.add(ev.text)
                    block = f"[Source: {ev.source} | Doc: {ev.document_name} | Cat: {ev.category}]\n{ev.text}"
                    evidence_blocks.append(block)
            evidence_text = "\n\n".join(evidence_blocks)
            
            if status == "partial":
                evidence_text = "WARNING: Retrieval was partially successful or limited.\n\n" + evidence_text
                
        mode = state.get("analysis_mode", "incident")
        
        # Deterministic Aggregation for Campaign
        aggregated_stats = ""
        if mode == "campaign":
            camp = state["campaign_input"]
            ep = set()
            sec = set()
            ci = set()
            max_sev = 0
            sev_map = {"low": 1, "medium": 2, "high": 3, "critical": 4}
            inv_map = {1: "low", 2: "medium", 3: "high", 4: "critical"}
            for inc in camp.incidents:
                ep.update(inc.affected_endpoints)
                meta = inc.metadata if isinstance(getattr(inc, "metadata", None), dict) else {}
                sector = meta.get("sector") or meta.get("affectedSector")
                if sector:
                    sec.add(str(sector))
                for item in meta.get("affectedSectors") or []:
                    sec.add(str(item))
                crit = str(meta.get("criticality") or "").lower()
                if crit in ("high", "critical"):
                    ci.update(inc.affected_endpoints)
                extra_ci = meta.get("criticalInfrastructure") or meta.get("critical_infrastructure")
                if extra_ci:
                    if isinstance(extra_ci, (list, tuple, set)):
                        ci.update(str(x) for x in extra_ci)
                    else:
                        ci.add(str(extra_ci))
                s_val = sev_map.get(inc.severity.value, 1)
                if s_val > max_sev: max_sev = s_val
                
            aggregated_stats = (
                f"\n\n[DETERMINISTIC AGGREGATION]\n"
                f"You MUST use these exact aggregated values in your impact and assessment blocks:\n"
                f"Highest Severity: {inv_map.get(max_sev, 'low')}\n"
                f"Affected Endpoints: {list(ep)}\n"
                f"Affected Sectors: {list(sec)}\n"
                f"Critical Infrastructure: {list(ci)}\n"
            )
            
        messages = [
            SystemMessage(content=COMMANDER_SYSTEM_PROMPT),
            HumanMessage(content=f"Analysis Mode: {mode.upper()}\n"
                                 f"Event Details:\n{input_dump}{aggregated_stats}\n\n"
                                 f"Retrieved Authoritative Evidence:\n{evidence_text}\n\n"
                                 f"You MUST provide your assessment as a JSON object matching this exact JSON Schema:\n"
                                 f"{json.dumps(CommanderResponse.model_json_schema(), indent=2)}\n\n"
                                 f"Do not include markdown wrapping or extraneous text.")
        ]
        
        if hasattr(llm, "bind"):
            llm = llm.bind(format="json")

        response = llm.invoke(messages)
        t1 = time.perf_counter()
        ass_lat = (t1-t0)*1000
        logger.info(f"Assessment Generation Latency: {ass_lat:.2f}ms")
        
        # Calculate context size metrics
        context_size = len(evidence_text)
        final_count = len(evidence_list)
        
        return {
            "raw_llm_output": response.content, 
            "assessment_latency_ms": ass_lat,
            "llm_call_count": state.get("llm_call_count", 0) + 1,
            "evidence_context_size": context_size,
            "final_evidence_count": final_count,
            **extract_provider_metrics(response)
        }
        
    except Exception as e:
        logger.error(f"LLM invocation failed: {str(e)}")
        t1 = time.perf_counter()
        return {"error": f"LLM invocation failed: {str(e)}", "assessment_latency_ms": (t1-t0)*1000}

def validate_structured_output(state: AgentState) -> AgentState:
    if state.get("error"):
        return state

    raw_output = state.get("raw_llm_output", "")
    logger.debug(f"Validating LLM output")
    
    attempts = state.get("correction_attempts", 0)
    
    try:
        clean_output = raw_output.strip()
        if clean_output.startswith("```json"):
            clean_output = clean_output[7:]
        if clean_output.startswith("```"):
            clean_output = clean_output[3:]
        if clean_output.endswith("```"):
            clean_output = clean_output[:-3]
        
        parsed_json = json.loads(clean_output.strip())
        mode = state.get("analysis_mode", "incident")
        _, _, _, _, log_id, _ = get_incident_summary(state)
        
        parsed_json["analysis_mode"] = mode
        if mode == "campaign":
            parsed_json["campaignId"] = log_id
            if "incidentId" in parsed_json:
                del parsed_json["incidentId"]
        else:
            parsed_json["incidentId"] = log_id
            if "campaignId" in parsed_json:
                del parsed_json["campaignId"]
        commander_response = CommanderResponse(**parsed_json)
        if attempts > 0:
            logger.info("Correction attempt successful.")
        return {"commander_response": commander_response, "validation_errors": None}
        
    except json.JSONDecodeError as e:
        error_msg = f"JSONDecodeError: {str(e)}"
        if attempts == 0:
            logger.error(f"Initial LLM output failed JSON parsing: {e}")
            return {"validation_errors": error_msg}
        else:
            logger.error("Correction attempt failed JSON parsing.")
            return {"error": "Malformed LLM output - Invalid JSON"}
            
    except ValidationError as e:
        error_msg = f"ValidationError: {str(e)}"
        if attempts == 0:
            logger.error(f"Initial LLM output failed schema validation: {e}")
            return {"validation_errors": error_msg}
        else:
            logger.error("Correction attempt failed schema validation.")
            return {"error": "Structured response validation failure"}

def correct_assessment(state: AgentState) -> AgentState:
    logger.info("Initial validation failed. Starting self-correction attempt (1/1).")
    t0 = time.perf_counter()
    
    try:
        provider = get_llm_provider()
        llm = provider.get_model()
        
        evidence_text = "No authoritative evidence available."
        status = state.get("retrieval_status", "unavailable")
        evidence_list = state.get("retrieved_evidence", [])
        
        if status in ["success", "partial"] and evidence_list:
            evidence_blocks = []
            for idx, ev in enumerate(evidence_list, 1):
                block = f"[Source: {ev.source} | Doc: {ev.document_name} | Cat: {ev.category}]\n{ev.text}"
                evidence_blocks.append(block)
            evidence_text = "\n\n".join(evidence_blocks)
            
            if status == "partial":
                evidence_text = "WARNING: Retrieval was partially successful or limited.\n\n" + evidence_text
                
        schema_json = json.dumps(CommanderResponse.model_json_schema(), indent=2)
        
        mode = state.get("analysis_mode", "incident")
        _, _, _, _, _, input_dump = get_incident_summary(state)
        
        messages = [
            SystemMessage(content="You are an AI Commander self-correction system. Your task is to fix a malformed JSON output that failed Pydantic validation. DO NOT introduce new facts or evidence. Only correct the structure to match the provided schema."),
            HumanMessage(content=f"Analysis Mode: {mode.upper()}\n"
                                 f"Event Details:\n{input_dump}\n\n"
                                 f"Retrieved Authoritative Evidence:\n{evidence_text}\n\n"
                                 f"Previous Malformed LLM Output:\n{state.get('raw_llm_output', '')}\n\n"
                                 f"Validation Errors:\n{state.get('validation_errors', '')}\n\n"
                                 f"You MUST provide your corrected assessment as a JSON object matching this exact JSON Schema:\n"
                                 f"{schema_json}\n\n"
                                 f"Return ONLY valid JSON.")
        ]
        
        if hasattr(llm, "bind"):
            llm = llm.bind(format="json")

        response = llm.invoke(messages)
        t1 = time.perf_counter()
        corr_lat = (t1-t0)*1000
        logger.info(f"Correction Attempt Finished in {corr_lat:.2f}ms")
        
        return {
            "raw_llm_output": response.content,
            "correction_attempts": state.get("correction_attempts", 0) + 1,
            "correction_latency_ms": corr_lat,
            "llm_call_count": state.get("llm_call_count", 0) + 1,
            **extract_provider_metrics(response)
        }
        
    except Exception as e:
        logger.error(f"Correction LLM invocation failed: {str(e)}")
        t1 = time.perf_counter()
        return {
            "error": f"Correction LLM invocation failed: {str(e)}", 
            "correction_latency_ms": (t1-t0)*1000,
            "correction_attempts": state.get("correction_attempts", 0) + 1
        }

def validate_safety(state: AgentState) -> AgentState:
    if state.get("error") or not state.get("commander_response"):
        return state
        
    t0 = time.perf_counter()
    resp = state["commander_response"]
    unsafe_keywords = ["shut down", "power off", "disable", "disconnect", "stop", "immediately shut down"]
    safe_keywords = ["isolate affected network", "segment", "restrict", "preserve monitoring"]
    
    unsafe_recs = []
    for i, rec in enumerate(resp.recommendations):
        action_lower = rec.action.lower()
        is_unsafe = False
        for uk in unsafe_keywords:
            if uk in action_lower:
                is_unsafe = True
                for sk in safe_keywords:
                    if sk in action_lower:
                        is_unsafe = False
                        break
                if is_unsafe:
                    unsafe_recs.append(i)
                    break
                    
    lat = (time.perf_counter()-t0)*1000
    if not unsafe_recs:
        logger.info(f"Safety Validation passed in {lat:.2f}ms")
        return {"safety_validation_latency_ms": lat, "validation_errors": None}
        
    logger.warning(f"Unsafe OT/ICS recommendations detected: indices {unsafe_recs}")
    return {"safety_validation_latency_ms": lat, "validation_errors": f"unsafe_recs:{','.join(map(str, unsafe_recs))}"}

def correct_safety(state: AgentState) -> AgentState:
    t0 = time.perf_counter()
    val_err = state.get("validation_errors", "")
    if not val_err.startswith("unsafe_recs:"):
        return state
        
    unsafe_indices = [int(x) for x in val_err.split(":")[1].split(",")]
    resp = state["commander_response"]
    provider = get_llm_provider()
    llm = provider.get_model()
    res = None
    
    for idx in unsafe_indices:
        unsafe_rec = resp.recommendations[idx]
        prompt = f"""You are a safety correction system for OT/ICS.
The following recommendation violates safety policies because it suggests a potentially dangerous operational disruption.
Unsafe Recommendation: "{unsafe_rec.action}" (Priority: {unsafe_rec.priority})

Safety Policy: DO NOT recommend automated blocking, shut down, power off, or disconnection of OT/ICS systems, controllers, PLCs, or SCADA without qualification. Prioritize controlled containment, network segmentation, traffic restriction, and preservation of monitoring.

Rewrite ONLY the action string to be safe and context-aware. Return ONLY a JSON object with keys "action" and "priority"."""
        
        try:
            if hasattr(llm, "bind"):
                corr_llm = llm.bind(format="json")
            else:
                corr_llm = llm
            res = corr_llm.invoke([HumanMessage(content=prompt)])
            
            raw_out = res.content.strip()
            if raw_out.startswith("```json"): raw_out = raw_out[7:]
            if raw_out.startswith("```"): raw_out = raw_out[3:]
            if raw_out.endswith("```"): raw_out = raw_out[:-3]
            
            parsed = json.loads(raw_out.strip())
            new_action = parsed.get("action", "")
            
            # Re-validate
            action_lower = new_action.lower()
            unsafe_keywords = ["shut down", "power off", "disable", "disconnect", "stop", "immediately shut down"]
            safe_keywords = ["isolate affected network", "segment", "restrict", "preserve monitoring"]
            
            is_still_unsafe = False
            for uk in unsafe_keywords:
                if uk in action_lower:
                    is_still_unsafe = True
                    for sk in safe_keywords:
                        if sk in action_lower:
                            is_still_unsafe = False
                            break
                    if is_still_unsafe:
                        break
                        
            if is_still_unsafe or not new_action:
                logger.warning(f"Correction still unsafe. Dropping recommendation.")
                unsafe_rec.action = "DROPPED_UNSAFE"
            else:
                unsafe_rec.action = new_action
                unsafe_rec.priority = parsed.get("priority", unsafe_rec.priority)
                logger.info(f"Successfully corrected unsafe recommendation.")
                
        except Exception as e:
            logger.error(f"Safety correction failed: {e}. Dropping recommendation.")
            unsafe_rec.action = "DROPPED_UNSAFE"
            
    # Filter out dropped
    resp.recommendations = [r for r in resp.recommendations if r.action != "DROPPED_UNSAFE"]
    lat = (time.perf_counter()-t0)*1000
    extra = extract_provider_metrics(res) if res is not None else {}
    return {"commander_response": resp, "safety_correction_latency_ms": lat, "validation_errors": None, "llm_call_count": state.get("llm_call_count", 0) + len(unsafe_indices), **extra}

def route_validation(state: AgentState) -> str:
    if state.get("error"):
        return END
    val = state.get("validation_errors")
    if val:
        if val.startswith("unsafe_recs:"):
            return "correct_safety"
        else:
            return "correct_assessment"
    return "validate_safety"

def route_safety(state: AgentState) -> str:
    if state.get("error"):
        return END
    val = state.get("validation_errors")
    if val and val.startswith("unsafe_recs:"):
        return "correct_safety"
    return END

def route_sufficiency(state: AgentState) -> str:
    suff = state.get("evidence_sufficiency")
    if suff and not suff.sufficient:
        return "targeted_retrieval"
    return "generate_assessment"

def create_commander_graph(retriever) -> StateGraph:
    workflow = StateGraph(AgentState)
    
    retrieve_knowledge_node = build_retrieve_knowledge_node(retriever)
    targeted_retrieval_node = build_targeted_retrieval_node(retriever)
    
    workflow.add_node("generate_retrieval_plan", generate_retrieval_plan)
    workflow.add_node("retrieve_knowledge", retrieve_knowledge_node)
    workflow.add_node("assess_evidence_sufficiency", assess_evidence_sufficiency)
    workflow.add_node("targeted_retrieval", targeted_retrieval_node)
    workflow.add_node("generate_assessment", generate_assessment)
    workflow.add_node("validate_structured_output", validate_structured_output)
    workflow.add_node("correct_assessment", correct_assessment)
    workflow.add_node("validate_safety", validate_safety)
    workflow.add_node("correct_safety", correct_safety)
    
    workflow.add_edge(START, "generate_retrieval_plan")
    workflow.add_edge("generate_retrieval_plan", "retrieve_knowledge")
    workflow.add_edge("retrieve_knowledge", "assess_evidence_sufficiency")
    
    workflow.add_conditional_edges(
        "assess_evidence_sufficiency",
        route_sufficiency,
        {
            "targeted_retrieval": "targeted_retrieval",
            "generate_assessment": "generate_assessment"
        }
    )
    workflow.add_edge("targeted_retrieval", "generate_assessment")
    workflow.add_edge("generate_assessment", "validate_structured_output")
    
    workflow.add_conditional_edges(
        "validate_structured_output",
        route_validation,
        {
            "correct_assessment": "correct_assessment",
            "validate_safety": "validate_safety",
            "correct_safety": "correct_safety",
            END: END
        }
    )
    workflow.add_edge("correct_assessment", "validate_structured_output")
    
    workflow.add_conditional_edges(
        "validate_safety",
        route_safety,
        {
            "correct_safety": "correct_safety",
            END: END
        }
    )
    workflow.add_edge("correct_safety", END)
    
    return workflow.compile()
