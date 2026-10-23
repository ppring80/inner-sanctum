# Owned frozen evidence inspection

On the enabled private reviewer deployment, `get_shadow_decision` includes
`artifact.ownedFrozenEvidence` for a caller with an authorized linked snapshot.
This is an additive read-only diagnostic, independent of whether a paid model
review exists. Existing scorecards and saved-review responses remain available.

The reader derives ownership from authenticated context, never a caller-supplied
owner. It reads only that owner's immutable evidence entry for the requested
64-character decision ID, validates the stored owner and SHA-256 of the exact
serialized packet, and applies existing producer bounds (40 players, 20 slots,
90,000 serialized characters). Missing, corrupt, oversized or inaccessible input
returns an explicit unavailable status. It never reconstructs historical input
from today's data, truncates a packet, lists another owner's entries, repairs a
record or retries a provider call.

The response contains only the packet, its evidence hash, the original capture
time when valid and read-only availability metadata. Owner hashes, storage keys,
credentials and other storage-envelope properties are excluded. A similarly
named field in the shared scorecard cannot substitute for the owner-scoped read.
An unlinked caller retains existing scorecard access but receives no owned input.
The private deployment gate remains required; HTTP OAuth/scope checks are unchanged.

No model call, provider budget reservation, history write, queue, refresh,
recalculation, new ranking or customer decision occurs. The existing full saved
review reader already offers frozen-input access through the same ownership and
hash requirements; that capability remains intact.

Verification must hash the returned packet before inspecting it, use its saved
source dates and qualifying game IDs, and distinguish the immutable capture from
current data. A saved evidence packet contains model-neutral player facts, not
the entire production decision engine or every intermediate gate. Combine its
facts with the matching customer decision and unchanged policy regression tests;
do not claim an independent full engine replay from the input packet alone.
