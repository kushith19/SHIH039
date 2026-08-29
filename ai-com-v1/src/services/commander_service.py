import json
import logging
import re
import time
from fastapi import HTTPException

from src.models.detection import DetectionInput
from src.models.commander import CommanderResponse, ExplainResponse
from src.agent.graph import create_commander_graph
from src.agent.llm_provider import get_llm_provider
from src.agent.prompts import EXPLAIN_EVIDENCE_PROMPT, COMMANDER_SYSTEM_PROMPT
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
        if isinstance(data, dict) and data.get("summary"):
            return str(data["summary"]).strip()
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(0))
                if isinstance(data, dict) and data.get("summary"):
                    return str(data["summary"]).strip()
            except json.JSONDecodeError:
                pass
    return raw


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
            response = llm.invoke(messages)
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
            # LangGraph currently is sync by default unless async nodes are defined, 
            # we invoke it asynchronously using ainvoke.
            final_state = await self._graph.ainvoke(initial_state)
            t1 = time.perf_counter()
            total_lat = (t1-t0)*1000
            
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
                logger.info(f"Sufficiency Bypassed: {final_state.get('deterministic_bypass_reason', 'Met criteria')}")
                
            if final_state.get("targeted_retrieval_used"):
                logger.info(f"Targeted Retrieval Latency: {tgt_lat:.2f}ms")
            logger.info(f"Assessment Latency: {ass_lat:.2f}ms")
            if final_state.get("correction_attempts", 0) > 0:
                logger.info(f"Correction Latency: {corr_lat:.2f}ms")
            logger.info(f"Total Request Latency: {total_lat:.2f}ms")
            
            logger.info(f"--- Execution Metrics ---")
            logger.info(f"LLM Provider: {final_state.get('llm_provider', 'unknown')}")
            logger.info(f"LLM Model: {final_state.get('llm_model', 'unknown')}")
            fallback_used = final_state.get('provider_fallback_used')
            if fallback_used:
                logger.info(f"Fallback Used: true")
                logger.info(f"Fallback Provider: ollama")
                logger.info(f"Fallback Reason: {final_state.get('provider_fallback_reason', 'unknown')}")
            else:
                logger.info(f"Fallback Used: false")
                
            logger.info(f"Total LLM Calls: {final_state.get('llm_call_count', 0)}")
            logger.info(f"Evidence Context Size: {final_state.get('evidence_context_size', 0)} chars")
            logger.info(f"Final Evidence Count: {final_state.get('final_evidence_count', 0)} chunks")
            logger.info(f"----------------------------------------")
            
            if final_state.get("error"):
                logger.error(f"Commander workflow failed: {final_state['error']}")
                raise HTTPException(status_code=500, detail=final_state["error"])
                
            if not final_state.get("commander_response"):
                logger.error("Commander workflow completed but no response was generated.")
                raise HTTPException(status_code=500, detail="Failed to generate Commander Response")
                
            logger.info(f"Successfully generated CommanderResponse for incident: {detection.incident_id}")
            return final_state["commander_response"]
            
        except HTTPException:
            raise
        except Exception as e:
            logger.exception(f"Unexpected error during Commander analysis: {e}")
            raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")
