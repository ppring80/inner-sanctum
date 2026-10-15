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

The complete live Week 6 input was subsequently recovered through the owned
read-only reader added by PR #278. Its parent hash matches
`d4c17ca05a2b09cf4598bd33c6c6349fe140afe48abf1f815f3aab6305595953`.
The reconstructed current request matches all saved component fingerprints:
system, evidence, schema and output-token ceiling.

On that exact packet (16 players, 10 slots, 172 facts):

| Local measurement | Current | Candidate |
|---|---:|---:|
| Complete request bytes | 67,247 | 64,298 |
| Frozen evidence / dictionary evidence bytes | 50,244 | 46,448 |
| Output-token ceiling | 3,300 | 1,800 |

The request is 4.39% smaller. Two source dictionary entries are used; the
candidate also adds 6,287 bytes of explicit player measurements. All original
evidence round-trips exactly. Five alert references are required. No actual
candidate output-token count or latency exists.

The latest deployed full review used 19,085 input and 2,224 output tokens,
with 48.806 seconds from worker capture to completion. Those measurements
describe the deployed full-review path, not this candidate.

Exact-input inspection also corrected an earlier diagnosis: Nabers' recorded
games had 6, 7 and 20 targets with zero carries, so an 11-target average was
supported. The deployed field-presence validator rejected it because the packet
had no separate observedTargets field. The candidate can verify the component
numbers from the complete three-game record. Do not characterize that specific
claim as a model factual error. The saved same-matchup contradiction and
duplicate-player contingency remain rejected by the candidate checks. A
complete hypothetical two-slot swap passes legality checks; it is a test case,
not new lineup advice.

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

The actual input is now measured. Review the modest 4.39% request saving and the
untested output-structure reduction before authorizing any paid comparison.
Do not remove evidence or promise a 15-second result from byte counts. A paid
comparison needs its own explicit authorization and separate history-preserving
record. Keep all deployed decision paths unchanged until an isolated candidate
qualifies and customer integration is authorized. The raw private packet remains
local, outside this repository; the script accepts an authorized saved response
and prints measurement summaries only.

## One authorized private qualification

`_rookie-candidate-qualification.js` now exposes one separately stored private run through the existing full-review tool and signed background worker. Authorization expires after UTC 2026-10-15 and pins the original decision/evidence, failed post-276 request, and entire candidate request hash (model, prompt, evidence, schema and output limit). An atomic global reservation permits one provider call, including failed calls; delivery and reads never retry it. Original full and post-276 results remain available in the saved reader as `priorReview` and `priorQualification`. No customer presenter or promotion path consumes this candidate.

A successful schema/validator result still requires manual semantic review. `providerMs` measures provider request through response decoding; worker timestamps and observed tool delivery must be reported separately. This wiring is not evidence of either speed or answer quality.
