# Test-only synthetic ESPN browser acceptance

Not for merging into main. No live ESPN login, provider session, private-roster
upload, production publication, or installed-user extension operation is authorized.

The generated extension has only the exact Test Sanctum host permission, no ESPN
or production permissions. Its ESPN capture source and content bridge are reused
unchanged. They run on an isolated synthetic provider page; a preceding fixture
transport answers the three ESPN capture requests in memory. Browser automation
also intercepts every request and denies any external destination. Thus this
verifies extension execution and API-shaped fixture parsing, not real ESPN
origin permissions, login/cookies, live payload variability or live team ownership.

The small connection page reuses the real connection manager, adapters and exact
snapshot-builder functions. The worker reuses the actual capture-delivery function.
There is no tracking, provider refresh, production connection link, or decision
execution. Explicit synthetic-session and upload buttons replace automatic upload.
A separate variant is generated; neither production extension sources nor the
user's existing private extension are enabled or changed.

The new endpoint accepts an exact Test Sanctum Origin, bounded POST bodies, an
issued HttpOnly Secure SameSite cookie and only the two reviewed fixture shapes.
It rejects Authorization headers, unknown fields, identities, credentials and
fixture mismatches. The fixture-only cookie is not reviewer/admin authorization
and must never be extended to real private uploads. No OAuth pairing is added.
Authenticated MCP tools inspect, clean and independently verify the synthetic store.
All tool-call authentication remains the existing Test Sanctum OAuth gate.

The dedicated store has a single fixed session record. Conditional ETag writes
fence upload, replay and cleanup races atomically on that record. Expiry does not
reopen a session. Cleanup removes snapshots by rewriting the session, deletes any
unexpected objects, and leaves VERIFY_REQUIRED. A new invocation reads storage
fresh, enumerates all list pages, checks the record is empty, and conditionally
marks CLEAN. A stale read cannot pass that ETag transition. Failure leaves new
sessions blocked. If cleanup itself crashes, repeat cleanup and independent
verification. No private data is permitted; no automatic physical retention
promise or deletion of provider-managed historical backups is made.

The original seven assertion conditions remain unchanged. The new stored tool
runs them against stored canonical snapshots with the original browser capture
timestamp as its expected value. Missing fixture timestamp remains null. Explicit
week 8/10 is supplied by the synthetic test UI separately from period 7/9.
Existing fixed-assertion tool and customer decisions remain separate and unchanged.

Before deployment: real automated Chromium extension execution against intercepted
Test Sanctum routes and local Blobs emulator; actual Netlify bundling/runtime;
negative credential/origin/fixture/unauthorized/replay/expiry/crash/cleanup tests;
full regression and CI. These are local/CI proofs, not hosted Blobs acceptance.
After separately approved deployment: repeat against hosted storage and OAuth,
verify cleanup independently, and record deployment SHA. Do not promote on local
results alone. Rollback: close the test session, verify cleanup, disable this
variant and restore accepted synthetic Test Sanctum SHA 48a2604. Production is
untouched and publishing stays locked. The FLEX optimizer is excluded.
