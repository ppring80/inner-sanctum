# Bounded defensive-evidence recovery

Scope: defensive collection/validation and its existing recovery status only. No scoring, ranking, selection, schedules, provider-budget settings, or customer decision authority changes.

## Policy

- At most four attempts per season/week/season-type status key. Wait 30, 60 and 120 minutes after the first three unsuccessful builds. The existing ten-minute watchdog dispatches when the wait expires; it is not rescheduled.
- Keep the existing conditional claim and 20-minute lease. Expired leases can resume only within the same four-attempt allowance. UTC rollover does not replenish defensive attempts. Other jobs keep their existing retry policy.
- Retry provider request failures (network, timeout, HTTP 429/5xx), invalid/incomplete provider responses, missing required statistics and unfinished schedules. All retryable cases remain bounded.
- Stop on processing, identity and structural validation failures. Provider HTTP 4xx other than 429 is a deterministic validation failure. Existing authenticated diagnostics expose the fixed category, bounded public game IDs/counts and blocked reason.
- Budget rejection makes no provider calls and waits for the next UTC budget day within the remaining attempt allowance. No budget or kill-switch override is added.
- Complete evidence is never rebuilt. Failed builds never replace previous evidence. Successful recovery retains the previous bounded failure summary.
- Existing recorded attempts are preserved on policy adoption. Older, overwritten attempt history cannot be reconstructed. An exhausted job or deterministic failure requires operator review; this change intentionally does not reset it.

Missing numeric values remain null at parsing and fail required-stat checks before aggregation. Explicit numeric zeroes remain valid. The writer also rejects incomplete normalized defense profiles. Successful-build arithmetic is unchanged.

## Acceptance evidence and limits

`node -r ./tests/test-runtime-bootstrap.js tests/weekly-defense-recovery.test.js`

This suite blocks all real network access. It exercises the real Blobs SDK against an in-memory synthetic HTTP transport, the existing watchdog and signed worker, two incomplete provider builds followed by same-day success, atomic concurrent claims, budgets, all three backoffs, attempt exhaustion across UTC reset, deterministic blocking, diagnostics and missing-versus-zero parsing.

Six positional workers return frozen synthetic outputs through the real worker loop and cache-completeness checks. The existing registered customer ranking, profile, comparison and lineup tools are then invoked against the synthetic recovered week. The comparison preserves its unresolved cross-position result and the shared lineup authority supplies starters. This does not claim a live Week 9 provider build or actual hosted acceptance of the candidate.

Actual Netlify bundling covers `refresh-weekly-sage-defense`, `weekly-sage-refresh-background`, `recover-weekly-sage` and `weekly-sage-status`. After extracting the writer ZIP, rerun the same suite with `DEFENSE_WRITER_BUNDLE` pointing to its top-level `refresh-weekly-sage-defense.js`. This executes the generated writer and its bundled SDK/dependencies, not the source writer. No Test Sanctum changes or new runtime dependencies are required.

Before release: full regression and GitHub CI must pass. Keep production publishing locked. After an approved publication, read-only verification should confirm deployed SHA, unchanged Week 8 readiness/customer controls, and authenticated diagnostic visibility. Actual automatic recovery during Week 9 must be assessed from retained status and complete caches, without forcing a production failure or bypassing validation.

Rollback: republish the currently accepted production deployment `6ae1638c0181d38cbb9082f4`, commit `c10f3c28045afed94d1101d2f926e85d7a22b425`. Do not delete status records, reset counters or modify budget ledgers. Rollback restores the old retry interpretation, so review retained attempt metadata without resetting it; existing provider budgets continue to apply.
