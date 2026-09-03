import asyncio
import json
import logging
import re
import time
from fastapi import HTTPException

from src.models.detection import DetectionInput, CampaignInput
from src.models.commander import (
    CommanderResponse,
    ExplainResponse,
    AskResponse,
    KnowledgeContextBody,
    KnowledgeSource,
    KnowledgeAskResponse,
)
from src.agent.graph import create_commander_graph
from src.agent.llm_provider import get_llm_provider
from src.agent.prompts import (
    EXPLAIN_EVIDENCE_PROMPT,
    COMMANDER_SYSTEM_PROMPT,
    KNOWLEDGE_CONTEXT_PROMPT,
    KNOWLEDGE_ASK_PROMPT,
)
from src.agent.risk_compose import knowledge_status_from_retrieval
from src.agent.knowledge_retrieval import (
    build_deterministic_retrieval_plan,
    retrieve_knowledge_chunks,
    strip_forbidden_keys,
    chunks_to_sources,
    fallback_structure_from_chunks,
)
from src.rag.retriever import VectorRetriever
from src.rag.embeddings.local_provider import LocalEmbeddingProvider
from src.rag.vectorstore.qdrant_store import QdrantStore
from src.config.settings import settings
from langchain_core.messages import HumanMessage, SystemMessage

logger = logging.getLogger(__name__)

def _parse_summary(text: str) -> str:
    raw = (text or "").strip()
    if not raw:
        return ""
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(0))
            except json.JSONDecodeError:
                return raw
        else:
            return raw
    if isinstance(data, dict) and data.get("summary"):
        return str(data["summary"]).strip()
    return raw


def _parse_json_object(text: str) -> dict:
    raw = (text or "").strip()
    if not raw:
        return {}
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(0))
                return data if isinstance(data, dict) else {}
            except json.JSONDecodeError:
                return {}
    return {}


def _unavailable_knowledge(reason: str = "Knowledge retrieval unavailable") -> KnowledgeContextBody:
    return KnowledgeContextBody(
        retrieved=False,
        reason=reason,
        knowledgeStatus="unavailable",
        attackUnderstanding=[],
        relevantKnowledge=[],
        preventionGuidance=[],
        sources=[],
        queries=[],
    )


def _structure_to_body(
    structured: dict,
    *,
    chunks,
    retrieval_status: str,
    queries: list,
) -> KnowledgeContextBody:
    cleaned = strip_forbidden_keys(structured or {})
    sources_raw = cleaned.get("sources") or chunks_to_sources(chunks)
    sources = []
    for s in sources_raw:
        if isinstance(s, dict):
            sources.append(
                KnowledgeSource(
                    document=s.get("document") or s.get("document_name"),
                    source=s.get("source"),
                    section=s.get("section"),
                    page=s.get("page") if s.get("page") is not None else s.get("page_number"),
                    score=s.get("score"),
                    category=s.get("category"),
                )
            )
    status = knowledge_status_from_retrieval(
        chunk_count=len(chunks), retrieval_status=retrieval_status
    )
    return KnowledgeContextBody(
        retrieved=True,
        reason=None,
        knowledgeStatus=status,
        attackUnderstanding=[
            str(x)
            for x in (
                cleaned.get("attackUnderstanding")
                or cleaned.get("attack_understanding")
                or []
            )
            if x
        ][:6],
        relevantKnowledge=[
            str(x)
            for x in (
                cleaned.get("relevantKnowledge")
                or cleaned.get("relevant_knowledge")
                or []
            )
            if x
        ][:8],
        preventionGuidance=[
            str(x)
            for x in (
                cleaned.get("preventionGuidance")
                or cleaned.get("prevention_guidance")
                or []
            )
            if x
        ][:6],
        sources=sources[:8],
        queries=[str(q) for q in queries if q][:4],
    )


class CommanderService:
    def __init__(self, retriever: VectorRetriever = None):
        self._retriever = retriever
        self._graph = None

    def _ensure_graph(self):
        if self._graph is not None:
            return
        retriever = self._retriever
        if retriever is None:
            embedder = LocalEmbeddingProvider(model_name=settings.embedding_model)
            qdrant = QdrantStore(
                url=settings.qdrant_url,
                collection_name=settings.qdrant_collection,
                dimension=embedder.get_dimension()
            )
            retriever = VectorRetriever(embedding_provider=embedder, vector_store=qdrant)
            self._retriever = retriever
        self._graph = create_commander_graph(retriever)

    def _ensure_retriever(self):
        if self._retriever is not None:
            return self._retriever
        self._ensure_graph()
        return self._retriever

    @property
    def graph(self):
        self._ensure_graph()
        return self._graph

    @property
    def retriever(self):
        self._ensure_graph()
        return self._retriever

    async def explain_detection(self, detection: DetectionInput) -> ExplainResponse:
        """Single LLM call: natural-language why, from Level-1 evidence only. No RAG."""
        logger.info(f"Explaining detection {detection.incident_id}")
        provider = get_llm_provider()
        llm = provider.get_model()
        if hasattr(llm, "bind"):
            try:
                llm = llm.bind(format="json")
            except Exception:
                pass
        messages = [
            SystemMessage(content=COMMANDER_SYSTEM_PROMPT + "\n\n" + EXPLAIN_EVIDENCE_PROMPT),
            HumanMessage(
                content=(
                    "Explain why this detection fired using only the supplied evidence.\n\n"
                    f"{detection.model_dump_json(indent=2)}\n\n"
                    'Return JSON: {"summary": "..."}'
                )
            ),
        ]
        try:
            response = await llm.ainvoke(messages)
        except Exception:
            response = await asyncio.to_thread(llm.invoke, messages)
        content = getattr(response, "content", None) or str(response)
        summary = _parse_summary(content)
        if not summary:
            raise HTTPException(status_code=500, detail="Failed to generate explanation")
        return ExplainResponse(incidentId=detection.incident_id, summary=summary)

    async def analyze_detection(self, detection: DetectionInput) -> CommanderResponse:
        """
        Produce a structured CommanderResponse from a DetectionInput using LangGraph and an LLM.
        """
        logger.info(f"Starting Commander analysis for incident: {detection.incident_id}")
        self._ensure_graph()

        initial_state = {
            "analysis_mode": "incident",
            "incident_input": detection,
            "raw_llm_output": None,
            "commander_response": None,
            "error": None
        }

        t0 = time.perf_counter()
        try:
            final_state = await self._graph.ainvoke(initial_state)
            t1 = time.perf_counter()
            total_lat = (t1 - t0) * 1000

            plan_lat = final_state.get("planning_latency_ms") or 0.0
            ret_lat = final_state.get("retrieval_latency_ms") or 0.0
            suff_lat = final_state.get("sufficiency_latency_ms") or 0.0
            tgt_lat = final_state.get("targeted_retrieval_latency_ms") or 0.0
            ass_lat = final_state.get("assessment_latency_ms") or 0.0
            corr_lat = final_state.get("correction_latency_ms") or 0.0

            logger.info(f"--- Timing Summary for {detection.incident_id} ---")
            logger.info(f"Query Planning Latency: {plan_lat:.2f}ms")
            logger.info(f"Retrieval Latency: {ret_lat:.2f}ms")

            suff_invoked = final_state.get("sufficiency_llm_invoked", True)
            if suff_invoked:
                logger.info(f"Sufficiency Latency: {suff_lat:.2f}ms")
            else:
                logger.info(
                    f"Sufficiency Bypassed: {final_state.get('deterministic_bypass_reason', 'Met criteria')}"
                )

            if final_state.get("targeted_retrieval_used"):
                logger.info(f"Targeted Retrieval Latency: {tgt_lat:.2f}ms")
            logger.info(f"Assessment Latency: {ass_lat:.2f}ms")
            if final_state.get("correction_attempts", 0) > 0:
                logger.info(f"Correction Latency: {corr_lat:.2f}ms")
            logger.info(f"Total Request Latency: {total_lat:.2f}ms")

            logger.info(f"--- Execution Metrics ---")
            logger.info(f"LLM Provider: {final_state.get('llm_provider', 'unknown')}")
            logger.info(f"LLM Model: {final_state.get('llm_model', 'unknown')}")
            fallback_used = final_state.get("provider_fallback_used")
            if fallback_used:
                logger.info("Fallback Used: true")
                logger.info("Fallback Provider: ollama")
                logger.info(
                    f"Fallback Reason: {final_state.get('provider_fallback_reason', 'unknown')}"
                )
            else:
                logger.info("Fallback Used: false")

            logger.info(f"Total LLM Calls: {final_state.get('llm_call_count', 0)}")
            logger.info(
                f"Evidence Context Size: {final_state.get('evidence_context_size', 0)} chars"
            )
            logger.info(
                f"Final Evidence Count: {final_state.get('final_evidence_count', 0)} chunks"
            )
            logger.info("----------------------------------------")

            if final_state.get("error"):
                logger.error(f"Commander workflow failed: {final_state['error']}")
                raise HTTPException(status_code=500, detail=final_state["error"])

            if not final_state.get("commander_response"):
                logger.error("Commander workflow completed but no response was generated.")
                raise HTTPException(status_code=500, detail="Failed to generate Commander Response")

            logger.info(
                f"Successfully generated CommanderResponse for incident: {detection.incident_id}"
            )
            return final_state["commander_response"]

        except HTTPException:
            raise
        except Exception as e:
            logger.exception(f"Unexpected error during Commander analysis: {e}")
            raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

    async def analyze_campaign(self, campaign: CampaignInput) -> CommanderResponse:
        logger.info(f"Starting Commander analysis for campaign: {campaign.campaign_id}")
        self._ensure_graph()
        initial_state = {
            "analysis_mode": "campaign",
            "campaign_input": campaign,
            "raw_llm_output": None,
            "commander_response": None,
            "error": None,
        }
        try:
            final_state = await self._graph.ainvoke(initial_state)
            if final_state.get("error"):
                logger.error(f"Commander campaign workflow failed: {final_state['error']}")
                raise HTTPException(status_code=500, detail=final_state["error"])
            if not final_state.get("commander_response"):
                raise HTTPException(status_code=500, detail="Failed to generate Commander Response")
            logger.info(
                f"Successfully generated CommanderResponse for campaign: {campaign.campaign_id}"
            )
            return final_state["commander_response"]
        except HTTPException:
            raise
        except Exception as e:
            logger.exception(f"Unexpected error during Commander campaign analysis: {e}")
            raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

    async def ask_snapshot(self, question: str, snapshot: dict) -> AskResponse:
        q = (question or "").strip().lower()
        snap = snapshot or {}
        if not q or not snap:
            return AskResponse(answer="Insufficient observed evidence.", insufficient=True)
        briefing = snap.get("briefing") or {}
        incidents = snap.get("incidents") or []
        if "evidence" in q:
            if not incidents:
                return AskResponse(answer="Insufficient observed evidence.", insufficient=True)
            return AskResponse(
                answer="Level-1 evidence is on promoted incidents in the snapshot. Commander will not invent telemetry.",
                insufficient=False,
            )
        summary = (briefing.get("assessment") or {}).get("summary")
        if summary and ("summary" in q or "assess" in q):
            return AskResponse(answer=str(summary), insufficient=False)
        return AskResponse(answer="Insufficient observed evidence.", insufficient=True)

    async def _structure_knowledge_llm(self, chunks, hints=None) -> dict:
        evidence_block = "\n\n".join(
            [
                f"[{i + 1}] source={ev.source} document={ev.document_name} "
                f"section={ev.section} score={ev.score:.3f}\n{ev.text[:1200]}"
                for i, ev in enumerate(chunks)
            ]
        )
        hints_json = json.dumps(hints or {}, default=str)[:2000]
        provider = get_llm_provider()
        llm = provider.get_model()
        if hasattr(llm, "bind"):
            try:
                llm = llm.bind(format="json")
            except Exception:
                pass
        messages = [
            SystemMessage(content=KNOWLEDGE_CONTEXT_PROMPT),
            HumanMessage(
                content=(
                    f"Incident hints (not proof of attack):\n{hints_json}\n\n"
                    f"Retrieved knowledge chunks:\n{evidence_block}\n\n"
                    "Structure knowledgeContext JSON only."
                )
            ),
        ]
        try:
            response = await llm.ainvoke(messages)
        except Exception:
            response = await asyncio.to_thread(llm.invoke, messages)
        content = getattr(response, "content", None) or str(response)
        return strip_forbidden_keys(_parse_json_object(content))

    async def enrich_knowledge(
        self,
        *,
        detection=None,
        query=None,
        incident_hints=None,
    ) -> KnowledgeContextBody:
        """
        Knowledge-only RAG enrichment. Never returns a response plan or actionIds.
        Soft-fails with retrieved=false on any retrieval/LLM error.
        """
        try:
            retriever = self._ensure_retriever()
        except Exception as e:
            logger.warning("Knowledge retriever init failed: %s", e)
            return _unavailable_knowledge("Knowledge retrieval unavailable")

        try:
            plan = build_deterministic_retrieval_plan(
                detection=detection,
                query_override=query,
                hints=incident_hints,
            )
            chunks, status = await asyncio.to_thread(
                retrieve_knowledge_chunks, retriever, plan, top_k=3, max_chunks=5
            )
            queries = [q.query for q in plan.queries]
            if not chunks:
                return _unavailable_knowledge("Knowledge retrieval unavailable")

            try:
                hints = incident_hints or (
                    detection.model_dump(by_alias=True) if detection else {}
                )
                structured = await self._structure_knowledge_llm(chunks, hints=hints)
                if not (
                    structured.get("attackUnderstanding")
                    or structured.get("attack_understanding")
                    or structured.get("relevantKnowledge")
                    or structured.get("relevant_knowledge")
                    or structured.get("preventionGuidance")
                    or structured.get("prevention_guidance")
                ):
                    structured = fallback_structure_from_chunks(chunks)
            except Exception as e:
                logger.warning("Knowledge LLM structuring failed: %s", e)
                structured = fallback_structure_from_chunks(chunks)

            return _structure_to_body(
                structured, chunks=chunks, retrieval_status=status, queries=queries
            )
        except Exception as e:
            logger.warning("Knowledge enrichment failed: %s", e)
            return _unavailable_knowledge("Knowledge retrieval unavailable")

    async def answer_with_knowledge(
        self,
        question: str,
        *,
        detection=None,
        query=None,
        incident_hints=None,
        live_facts=None,
    ) -> KnowledgeAskResponse:
        """Answer a knowledge follow-up using live facts + retrieved chunks."""
        q = (question or "").strip()
        if not q:
            return KnowledgeAskResponse(
                answer="Insufficient observed evidence.",
                insufficient=True,
                knowledgeContext=_unavailable_knowledge("No question provided"),
            )

        kc = await self.enrich_knowledge(
            detection=detection,
            query=query or q,
            incident_hints=incident_hints,
        )
        live = live_facts or {}
        observed = live.get("observed") or live.get("summary") or ""
        evidence = live.get("evidence") or []
        evidence_line = (
            "; ".join(str(x) for x in evidence[:6])
            if isinstance(evidence, list)
            else str(evidence)
        )

        if not kc.retrieved:
            parts = []
            if observed:
                parts.append(f"Observed: {observed}")
            if evidence_line:
                parts.append(f"Evidence: {evidence_line}")
            if not parts:
                return KnowledgeAskResponse(
                    answer="Insufficient observed evidence.",
                    insufficient=True,
                    knowledgeContext=kc,
                )
            parts.append("Knowledge: Knowledge retrieval unavailable.")
            return KnowledgeAskResponse(
                answer=" ".join(parts),
                insufficient=False,
                knowledgeContext=kc,
            )

        try:
            provider = get_llm_provider()
            llm = provider.get_model()
            if hasattr(llm, "bind"):
                try:
                    llm = llm.bind(format="json")
                except Exception:
                    pass
            knowledge_bullets = (
                (kc.attack_understanding or [])
                + (kc.relevant_knowledge or [])
                + (kc.prevention_guidance or [])
            )
            messages = [
                SystemMessage(content=KNOWLEDGE_ASK_PROMPT),
                HumanMessage(
                    content=(
                        f"Question: {q}\n\n"
                        f"liveFacts: {json.dumps(live, default=str)[:2500]}\n\n"
                        f"Retrieved knowledge bullets: {json.dumps(knowledge_bullets[:10])}\n"
                        f"Sources: {json.dumps([s.model_dump() for s in (kc.sources or [])][:5])}\n"
                    )
                ),
            ]
            try:
                response = await llm.ainvoke(messages)
            except Exception:
                response = await asyncio.to_thread(llm.invoke, messages)
            content = getattr(response, "content", None) or str(response)
            parsed = strip_forbidden_keys(_parse_json_object(content))
            answer = str(parsed.get("answer") or "").strip()
            if not answer:
                raise ValueError("empty knowledge ask answer")
            return KnowledgeAskResponse(
                answer=answer, insufficient=False, knowledgeContext=kc
            )
        except Exception as e:
            logger.warning("Knowledge ask LLM failed: %s", e)
            kn = (
                "; ".join((kc.relevant_knowledge or kc.attack_understanding or [])[:3])
                or "Retrieved guidance available in sources."
            )
            answer = (
                f"Observed: {observed or 'See live incident context.'} "
                f"Knowledge: {kn} "
                f"Evidence: {evidence_line or 'See Level-1 detection evidence.'}"
            )
            return KnowledgeAskResponse(
                answer=answer, insufficient=False, knowledgeContext=kc
            )
