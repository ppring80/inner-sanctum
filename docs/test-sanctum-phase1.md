# Test Sanctum Phase 1 automation — review before setup

This PR adds only orchestration, verification, tests and this document. It does
not alter production source, existing workflows, Netlify configuration, branch
protections, OAuth, credentials, league connections or the FLEX optimizer.
PR333/334/335 remain unmerged. Do not deploy the PR335 pilot until this workflow
has been reviewed and its one-time test-only setup is separately authorized.

## Fixed boundaries

- Repository: ppring80/inner-sanctum; trusted workflow must run from main.
- Permanent test branch: acceptance/test-sanctum (the only writable ref).
- Site ID: dcdb8384-114c-4f80-a2fe-acc0ecb39d57.
- Origin: https://sprightly-chebakia-13d478.netlify.app.
- Accepted recovery deployment: 6add7ec57d21cee22e7804a6.
- Accepted recovery SHA: 48a2604bad557072fe244fdc0c50e28569ce3707.
- Proposed pilot SHA: 5cc7e03a1bfab2e80f807bd50ac0ba564a4a11e0 (PR335).

The trusted workflow accepts manual dispatch or an exact owner command on a PR:
`/test-sanctum <SHA>` (or `/test-sanctum recover <accepted-SHA>`).
Only ppring80 with OWNER association, on a same-repository PR whose current head
matches that SHA, can use the comment command. Edited comments, other authors,
forks and stale heads are rejected by a separate read-only request job. This lets
the existing GitHub connection start an approved run without a PAT or requiring
the owner to operate Actions. Candidate PR code is never the orchestration source.
One job concurrency group serializes promotion/deployment without cancelling an
in-progress deployment; independent validation jobs can run concurrently. Unknown or unsettled prior deployments block reuse.
A hook is posted once; uncertain hook responses do not cause automatic retries.

Candidate code executes only on the validation runner, with contents:read and
no hook or promotion token. Checkouts do not persist credentials. Validation
runs existing regression, connection-lock, Chrome, synthetic browser and actual
Netlify bundling checks. These browser/storage checks remain synthetic/emulated.

Promotion runs on a separate runner. It checks out github.workflow_sha, never
the candidate or candidate artifacts, and installs no dependencies. Its only
write permission is contents:write for the fixed test ref. GitHub cannot scope
that token to a single branch: trusted reviewed code and the environment's
main-only branch policy are required. Existing production branch protections
must not be relaxed. checks:read and statuses:read supply deployment evidence. The request job also
uses pull-requests:read to bind owner comments to the current same-repo PR head.
No PAT, Netlify API token or unattended OAuth credential is introduced.

## One-time setup, only after workflow review

These are setup instructions, not authorization to execute them now.

1. Review/approve the automation PR. Only the reviewed workflow and helpers need
   to reach main; do not merge the test infrastructure/candidate PRs. Use a
   skip-netlify merge message to avoid a production build. Publishing stays locked.
2. Create the one test branch at the accepted recovery SHA. The agent can do this
   after authorization; this is not a repeated user branch-switching task.
3. On Test Sanctum only, configure that permanent branch as its production branch,
   retain base acceptance and the candidate's acceptance/netlify.toml build,
   publish and functions paths. Keep builds active. No production project setting
   is changed. The test site must publish its test builds to its stable origin.
4. Create a build hook on that exact test project for the permanent test branch.
   The URL is an opaque deployment capability: its owning site cannot be inferred
   from its URL. Verify the Test Sanctum project name/site ID on that screen once.
   Never copy a production hook, paste a hook in chat or commit it.
5. Enable the existing Netlify GitHub deploy-success/failure commit notifications
   for Test Sanctum. READY must be proven by a fresh provider notification linking
   the test site's deploy, plus the exact published SHA/site/origin in build.json.
   The accepted deployment currently has no Netlify commit status/check visible;
   this prerequisite must be checked before the pilot. If the existing integration
   cannot provide it, stop: do not add a PAT or substitute HTTP 200 for READY.
6. Create the GitHub environment test-sanctum-phase1 with deployment branches
   restricted to main (not all branches). Store only TEST_SANCTUM_BUILD_HOOK there.
   Set TEST_SANCTUM_HOOK_SITE_ID to the exact test site ID after verifying the hook.
   Keep TEST_SANCTUM_PHASE1_ENABLED unset/false until the reviewed pilot is approved.
   Then set it true. No repository-wide default permission or production policy
   change is needed. These operations require environment/secret administration
   and Netlify test-project configuration permission, one time only.

Candidate commits must carry [skip netlify] or [skip ci] to prevent a second
Git-triggered deployment when the test ref changes. The explicit hook triggers
the requested build. A candidate without the marker is BLOCKED, not rewritten.
After approval, the agent can post the owner command through the existing GitHub
connection (or dispatch the workflow where supported); no local CLI,
Chrome installation, ChatGPT-tool refresh or routine terminal command is required
from the owner. No PAT is needed for the owner-command path. No settings are configured by this PR.

## Reporting and stop-loss

One report job produces a JSON artifact and GitHub step summary. Validation
failure, missing setup, permission denial, unknown prior state, hook uncertainty,
missing fresh Netlify READY evidence or a published SHA mismatch cannot pass.
A SHA mismatch after provider success is FAIL; missing evidence is BLOCKED.
Every report states authenticatedHostedAcceptance: BLOCKED and
productionRelease: NOT_AUTHORIZED. A green Phase 1 job means deployment plumbing
passed; it is not customer acceptance or permission to publish production.

Use one reviewed automation PR and one approved pilot. No repeated deployment
attempts without explaining a failure. If broader credentials, a new GitHub App,
OAuth machinery, relaxed branch protection or substantial dependencies become
necessary, stop and report. The code uses Node standard modules and reuses the
existing Playwright/Netlify bundling tool versions for unprivileged tests.

## Recovery

No deployment or Git checkpoint is deleted. Preserve the recorded accepted
Netlify deployment and source SHA; Git history permits rebuilding even after
Netlify's own deployment-retention period. No storage rollback is implied.

An explicit recover dispatch accepts only the recorded recovery SHA. It reruns
that baseline's regression/connection/Chrome checks and its actual bundled seven
assertions. The newer PR335 browser path is not applicable to the older accepted
baseline and is not claimed as re-tested. It uses the same fixed branch, test
hook, SHA/READY verification and report path. Recovery cannot supersede a build
whose state is unknown: a branch/host mismatch remains BLOCKED until the prior
build is settled. No automatic rollback, production publication, secret changes,
private data cleanup or authorization bypass is attempted.
