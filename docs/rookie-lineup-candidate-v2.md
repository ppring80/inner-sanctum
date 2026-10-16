# Private lineup candidate v2

The October 15 v1 run failed after 38.159 seconds at the provider: it exhausted 1,800 output tokens and returned only lineup choices. Its 18,482 input tokens were only 3.16% below the earlier full review. That experiment is not a qualified answer.

V2 fixes the request design in a separate offline module. Player, fact and slot records use explicitly labeled table columns. Repeated complete values use a recursive dictionary; literal marker arrays are escaped. Every original fact, source, timestamp, eligibility rule and uncertainty survives decoding. The original evidence hash must match before the request can be built, and the reconstructed packet must match that same hash. Unknown record shapes fail closed rather than drop fields. No preferred lineup or winner is added.

The response uses ordered choices with short player/confidence/blocker keys, retaining the existing decision explanations, cited facts, metric comparisons, alert IDs and simultaneous contingency changes. Output capacity returns to 3,300 tokens rather than the failed 1,800 allocation. The existing independent-choice and whole-lineup validators still run after normalization, with an additional requirement for a legal contingency for each questionable starter. Neither raising capacity nor smaller bytes proves live completion or speed.

Exact original owned-input measurement: 16 players, 10 slots, 172 facts, 5 material alert references, 29 dictionary entries. The whole request falls from 64,298 to 38,026 bytes (40.86%); a hash-verified reconstruction preserves every original byte of the JSON packet. Live input token count, model interpretation of the encoding, answer completeness and delivery latency remain unverified.

Run the read-only measurement with `node scripts/measure-rookie-lineup-candidate-v2.js /path/to/saved-input.json`. It emits sizes, hashes and counts, never the private packet. Private input is not committed.

V2 is not imported by the worker or customer paths. The consumed v1 reservation, previous results, original provider content and pair prompt remain unchanged. This change creates no provider allowance, resets no budget and performs no paid run. A live qualification needs its own explicitly scoped authorization and exact request pin.
