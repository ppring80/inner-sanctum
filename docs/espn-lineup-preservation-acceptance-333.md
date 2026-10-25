# PR #333 private acceptance checklist

No merge, deployment, extension-store publication, slot optimization, paid calls,
or production configuration changes are part of this checklist preparation.

## Automated boundary evidence

Run `node tests/espn-lineup-context-preservation.test.js`. It executes existing
browser/backend roster extraction, connection persistence, browser snapshot
projection, real server snapshot canonicalization and final MCP normalization
with synthetic identities. Scoring period and explicit NFL week deliberately
differ. A second team/period and missing/malformed capture times are covered.
The full customer lineup response is compared with metadata absent/present.

## Private extension testing (not yet performed)

Use the Chrome Package workflow artifact from the exact reviewed PR head in an
isolated Chrome profile as an unpacked extension. Do not replace the customer's
installed extension or publish a store update. Use synthetic captured ESPN
responses in the existing browser harness first. Verify slot/player IDs and
default position extraction, then connection delivery and team selection.
Do not paste private payloads, cookies, tokens or roster details into reports.
Report only assertions, tested build SHA, counts and source-field presence.
Do not send private ESPN captures to Test Sanctum.

## Isolated hosted acceptance preparation

Use the established separate Test Sanctum site and frozen synthetic fixtures.
A candidate must combine only the reviewed preservation change with accepted
infrastructure, retaining all credential/storage/provider restrictions. Verify
actual function bundling before a separately approved deployment.

The current two-function Test Sanctum package has no league-snapshot ingestion
endpoint and the public lineup output intentionally omits this metadata. A
customer lineup answer alone cannot prove hosted snapshot preservation. Do not
claim hosted boundary acceptance from that answer. Before hosted boundary
testing, review a test-only synthetic assertion mechanism that exercises the
same canonicalization and returns only named PASS/FAIL assertions, never source
payloads. Do not add a production diagnostic or relax test-site restrictions.
The separate test-only candidate adds `get_espn_preservation_assertions` to the
generated isolated MCP copy, behind the existing OAuth checks. It accepts no
fixture or roster arguments; extra input is ignored. It runs fixed synthetic
snapshot/MCP cases and returns seven named PASS/FAIL fields only. The source
production MCP has no registration. Exceptions become FAIL without messages,
stack traces or logs. No new endpoint or storage-ingestion route is added.

Private extension artifact review found a separate blocker: the exact-head
Chrome workflow ZIP omits `league-sync-content-bridge.js`, referenced by its
manifest. Do not install that incomplete ZIP. No packaging repair or extension
publication is included in this candidate. Manifest version is 0.5.3 even though
the artifact filename retains the old 0.5.2 label.

After a reviewed test candidate is authorized, check OAuth and MCP rejection,
synthetic boundary assertions, unknown locks/eligibility, and unchanged
customer decisions. Missing capture timestamps must stay null despite server
sync/storage timestamps. Record exact deployment and source SHAs separately.

## Scope and remaining limits

Only verified capture fields are preserved. Full ESPN eligibility and lock
rules remain unknown. No inference from kickoff or storage time is allowed.
Passive `espnLineupSource` metadata is separate from existing decision context.
The optimizer and provider-rule acquisition require their own reviewed work.
