# Isolated offline full-lineup candidate

This experiment is not connected to MCP, a background worker, a provider, a
store, a budget, a customer presenter or either deployed Rookie path. The
Miller–Higbee prompt checkpoint remains unchanged.

## What is implemented

- One pure request builder for the full roster. The model still chooses the
  whole lineup independently. Arithmetic checks never select a starter.
- Complete lineup assignments; separate explanations for important decisions;
  required alert references; explicit conditional lineup changes.
- Player-bound projection, matchup and position-scoped rank measurements.
  Recent usage is explicitly carries plus targets over the supplied window.
  Carries/targets components derive only from three complete, internally
  consistent games and a matching supplied average. Missing components stay
  missing.
- A source dictionary that replaces repeated source metadata only when doing
  so saves bytes. Expansion must reproduce the original serialized evidence
  hash exactly. Original literal objects resembling dictionary markers remain
  literal. Dates, uncertainty, provenance and fact identities remain available.
- Independent validation of named comparison direction and scope, citations,
  selected-player identity, workload units and all required alert references.
- Simultaneous application of each proposed ruled-out contingency, followed by
  validation of the entire resulting lineup: complete/legal slots, unique
  starters, available players and removal of the assumed-out player.

## Offline evidence

`node tests/rookie-lineup-candidate.test.js` covers:

- A supported independent choice that opposes a small projection advantage.
- The observed false projection advantage, RB/TE rank comparison, renamed
  workload unit and contradictory same-matchup claim.
- A Corum-for-Barkley substitution that duplicates Corum at FLEX (rejected),
  and a complete two-slot substitution moving Corum and filling FLEX (accepted).
- Unavailable/IR and wrong-position replacements; the assumed-out player left
  starting; duplicate scenarios; missing alerts, citations and explanations;
  malformed input; ties; and factual dictionary round-trip integrity.

These are targeted regression checks, not comprehensive semantic verification.
The test's relationship fixtures reproduce the known failure patterns. They
are not the original private Week 6 frozen packet or new model responses.

## Size result and limits

On the existing sanitized historical Week 5 fixture, the current request is
32,880 bytes and the candidate request is 32,805 bytes: about 0.23% smaller.
That fixture has no repeated metadata qualifying for dictionary replacement.
It does not demonstrate a useful input-size reduction. The dictionary does
reduce a separate synthetic repeated-metadata fixture with exact round-trip
integrity; that result must not be represented as a live-input saving.

The complete live Week 6 evidence bytes have not been recovered through the
available saved-review reader. The latest live request used 19,085 input and
2,224 output tokens, with 48.806 seconds from worker capture to completion.
Those are measurements of the deployed full-review path, not this candidate.

The candidate reduces required repeated output fields and uses a slot-count
output ceiling. No live response exists for it. Neither its output size,
provider schema acceptance, semantic quality nor end-to-end speed has passed
qualification. The 15-second delivery gate remains unmet.

Alert references are an internal completeness check, not proof that a manager
has received a readable injury warning. A future private presentation test
must surface the actual material warning, non-obvious tradeoff and relevant
facts while retaining deeper evidence access. No customer release approval is
implied by this experiment.

## Next checkpoint

Recover the owned live frozen input through an authorized read-only reader and
measure the candidate's actual request before spending on generation. If the
request remains large, document the tradeoff rather than remove evidence or
add more wording rules. A paid comparison needs its own explicit authorization
and separate history-preserving record. Keep all deployed paths unchanged
until an isolated candidate qualifies and customer integration is authorized.
