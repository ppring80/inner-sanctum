# Close the retired full-lineup invocation route

A customer asking for Rookie after PR288 was offered a new external model review despite all SAGE slots being decided. The pasted result describes a complete model-authored lineup and an unsupported weather claim, which cannot be emitted by the structured-pair contract. The exact saved run and its provider timing were not available under either inspected recent decision ID; do not attribute the reported 75 seconds to provider time without its diagnostics.

The MCP tool still advertised and executed mode full through runFullRookieReview. This contradicted the unresolved-pair release boundary. The public tool handler now rejects full before authorization/store/provider/queue/budget access, including stale clients retaining the old enum. Remove the handler's full-review import and dispatch branch. Keep the enum solely to return an explicit safe retirement response for stale clients. Saved historical reads and offline modules stay available for diagnostics; no history is deleted.

Tool guidance now distinguishes the opt-in saved customer opinion from internal paid benchmarks. No unresolved pair or matching saved opinion means stop, not generate a different review. SAGE logic, scoring, sources, current lineup and optional saved-pair path remain unchanged. This repair makes no paid model call, refresh, new allowance or budget reset.

The actual MCP handler test checks authenticated and unauthenticated full calls fail without storage access or model invocation, while the existing focused benchmark remains intact. Full CI is required. Production can verify the retirement response without a provider call.
