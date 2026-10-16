# Rookie unresolved-pair repair — approval pending

Scope: the selected-pair preparation path only. No source refresh, scoring change, new model allowance, customer contract change or paid call is part of this patch. Historical full-lineup experiments and raw saved responses are preserved.

## Presentation and reconsideration

`prepareSelectedPair` produces `presentation: plain-v1` on a copy of the existing focused evidence. Matchups carry a plain phrase and a 1–5 favorability rank; role size is explicitly relative to position; role-expansion flags use reported/confirmed workload language. Original fact IDs and the original frozen parent remain unchanged. Comparison, claim and disclosure helpers accept both raw and plain representations. All five matchup levels, all pair orderings and ties are tested.

Only plain-v1 requests append guidance and override the reconsider schema description. The shared SYSTEM, ROLE_SYSTEM, GROUNDED_SYSTEM and GROUNDED_SCHEMA are hash-pinned to current main byte-for-byte. Reconsideration is a conservative clause-by-clause check: name a pair player, describe a setback for the pick or more work / resolution of existing status uncertainty for the alternative. Reinforcing, generic, negated or ambiguous clauses, invented diagnoses and opponent-statistic conditions are withheld. This is a targeted rule recognizer, not a complete natural-language proof engine; some valid unrecognized phrasings may be rejected. It never rewrites the model answer.

## Part 2 — explicit approval required before merge

For plain-v1 only, `report_like_customer_language` and the purely presentational `role_explanation_too_long` are advisory. They remain recorded in saved `softFlags` and on the separate opinion. All other checks remain hard by default, including incorrect selection, arithmetic/comparison reversals, factual/health errors, unit ambiguity, missing material disclosures, unavailable players, invalid citations, reconsider_not_reversal, provider timeout and incomplete output. Hard failures leave SAGE's answer unchanged. No existing stored failure is overwritten or cleared to manufacture a pass.

This changes the release gate. Do not merge this PR until Pat explicitly approves Part 2. A style-only flag is not factual clearance; independent semantic review remains required before claiming an answer correct.

## Read-only selected-pair timing

`get_saved_rookie_review` accepts `kind: selected-pairs`. After the existing owner and evidence-integrity checks, it paginates only that owner's decision/selected/request prefix and whitelists saved result, timing, usage and outgoing-fingerprint fields. It returns no storage keys, owner hash, request body or frozen evidence packet. It never invokes a provider, writes, reserves a budget or refreshes data. Old records lacking saved requestTiming return null; those timings cannot be reconstructed honestly.

New selected-pair records save requestTiming through validation and before persistence, explicitly scoped `THROUGH_VALIDATION_BEFORE_PERSIST`; persistMs is null there. The fresh tool response separately measures through persistence. Cache-read timing is explicitly `CURRENT_CACHE_READ`, not the original model duration. Full original function-handler time and time outside the function must be captured separately during an authorized invocation, not inferred from provider time or the current read.

Historical context, not a new benchmark: msg_011Cg58Fpy6iZ2hhYLZjfQEh had provider 17.178 s, full handler 18.332 s including provider, and client span 24.852 s. Outside-function remainder was 6.520 s. The server remainder beyond provider was 1.154 s. These measurements do not identify the cause of provider variability. No speed improvement is claimed for this patch; 13–15 s remains the target.

## Qualification and stop condition

Offline checks cover both real frozen Week 4 unresolved pairs, raw/plain parity and disclosures, parent integrity, directional reconsideration, style flag persistence/composition, hard reversal rejection, failure isolation, source prompt/schema pins and reader privacy/pagination/error paths.

After CI is green, obtain Part 2 merge approval. Deployment and separately authorized real-pair runs remain distinct steps. No paid runs are authorized by this patch. For subsequent live qualification report provider time, whole handler time, outside-function remainder and full client span; review every shown answer for factual correctness, confidence and a genuine reversal condition. SAGE's lineup and warnings must remain unchanged when Rookie fails. Stop after the specified qualification; no automatic iteration or retry.
