# Super SAGE Phase 2 — Retrieve + Reason

Phase 1 created durable, source-aware football knowledge. Phase 2 makes that library retrievable by server-side SAGE intelligence without changing the SAGE 2.0 plugin package or production ranking formulas.

## V1 retrieval contract

`retrieveFootballKnowledge(query, options)` returns:
- ranked relevant knowledge entries;
- knowledge class and validation status;
- confidence;
- source/provenance resolution;
- explicit production-use guardrail.

## Safety/quality rule

Retrieval is not ranking logic.

- FACT / CONCEPT / HISTORICAL_KNOWLEDGE / EXPERIENCE_NOTE may support explanation and research.
- HYPOTHESIS is research-only.
- VALIDATED_INSIGHT is merely eligible for later production integration; promotion still requires production regression/validation.
- No retrieved entry directly changes Weekly SAGE score/rank.

## Next integration

After tests/PR validation, wire retrieval behind a server-side SAGE analysis path. Do not change the submitted SAGE 2.0 package while review is active.
