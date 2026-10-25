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
No such hosted mechanism or deployment is implemented by this PR.

After a reviewed test candidate is authorized, check OAuth and MCP rejection,
synthetic boundary assertions, unknown locks/eligibility, and unchanged
customer decisions. Missing capture timestamps must stay null despite server
sync/storage timestamps. Record exact deployment and source SHAs separately.

## Scope and remaining limits

Only verified capture fields are preserved. Full ESPN eligibility and lock
rules remain unknown. No inference from kickoff or storage time is allowed.
Passive `espnLineupSource` metadata is separate from existing decision context.
The optimizer and provider-rule acquisition require their own reviewed work.

## Hosted synthetic acceptance recorded

Authenticated Test Sanctum run at 48a2604bad557072fe244fdc0c50e28569ce3707:
seven assertions PASS, stage COMPLETE, errorCategory NONE. This is hosted
synthetic normalization evidence; it does not establish private Chrome acceptance.

## Private ZIP acceptance — production extension stays untouched

Use only the reviewed ZIP and SHA-256 from the exact PR333 packaging workflow.
The ZIP now includes both league-sync-content-bridge.js and the transitive
service-worker dependency league-sync-worker.js. The packaging gate opens the
actual ZIP, resolves manifest and local script dependencies, rejects unexpected
archive entries, and proves deleting either dependency makes verification fail.

Perform these steps one at a time, reporting only the indicated result:

1. In Chrome's profile menu choose Add a profile, then continue without an
   account. Name it SAGE PR333 PRIVATE TEST. Do not enable Chrome sync, import
   browser data, sign in to ESPN/CBS/Sanctum, or visit production connection pages.
   Leave the usual Chrome profile and its installed extension untouched.
2. In that new profile, open chrome://extensions. Confirm the working Sanctum
   extension is absent. If it is present, stop: this is not an empty test profile.
3. Verify the downloaded ZIP's SHA-256 against the supplied value and extract it
   into a new dedicated folder. Never extract over the existing extension folder.
4. Enable Developer mode only in the test profile. Choose Load unpacked and select
   the extracted folder containing manifest.json. Do not use Update, Repair,
   Remove or Pack extension on any existing extension.
5. Confirm name The Inner Sanctum — Connect, version 0.5.3, with no Errors badge.
   Open its service worker inspector and confirm it loads without a missing-script
   error. Do not paste console logs or screenshots containing browser/session data.
   Report only LOAD PASS/FAIL and WORKER PASS/FAIL with the artifact SHA.
6. Stop before connecting any league. This step validates installation/worker
   startup only. The synthetic capture/normalization regression and hosted fixed
   assertions supply data-boundary evidence; a live ESPN capture is not authorized
   by this procedure and must not be uploaded to Test Sanctum.
7. When finished, close the test profile. Remove only the disposable test profile
   when requested. The working profile, its extension, and its connection state
   remain separate. No store publication or production update is involved.

Do not install from the prior incomplete ZIP. No optimizer, eligibility inference,
lock inference, SAGE decision changes, or extension permission changes are included.
