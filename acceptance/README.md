# SAGE acceptance environment — issue #325

This is a separate manual-deploy project. Never connect this project to main's
Git auto-deploys and never deploy the repository root or its production netlify.toml.
Do not merge PR #324 or #326 to establish the test connection.

## Project and identity

- Site ID: `dcdb8384-114c-4f80-a2fe-acc0ecb39d57`
- Stable origin: `https://sprightly-chebakia-13d478.netlify.app`
- Production site ID (explicitly forbidden): `bbb5d8ad-ab10-4354-9fa4-211c4034c6fe`
- MCP URL: `https://sprightly-chebakia-13d478.netlify.app/.netlify/functions/chatgpt-mcp`
- Discovery routes: `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`.
- Existing public-client OAuth registration, PKCE, scopes, cookies, token expiry,
  resource validation and authorization handlers are reused unchanged.

Production has no acceptance configuration and retains the production issuer/resource.
The acceptance wrapper supplies three nonsecret settings: SAGE_ACCEPTANCE_MODE=isolated,
SAGE_ACCEPTANCE_SITE_ID and SAGE_ACCEPTANCE_ORIGIN. SITE_ID must match Netlify's runtime site.
The production site is never an allowed acceptance identity.

## Preflight before deployment

1. In the test project's Environment variables, confirm no provider credentials,
   production tokens, manually supplied Blobs credentials, or private league data.
   Check inherited/shared variables as well as site variables, in Builds and Functions scopes.
   Do not export or paste any values. Current connector inventory returned no site
   variables and no shared team variables on 2026-10-24; recheck before publishing.
2. Keep the project unlinked from production Git continuous deployment. No plugins,
   integration or build hooks should inject credentials. Do not copy production settings.
3. Use only the artifact generated below. It has two entry points, no schedules,
   no refresh endpoints and only a notice/build manifest in the public directory.
   Helpers are private bundled dependencies, not public function endpoints.
4. The wrappers fail closed on mismatched site/Blobs identity or credential-like
   environment variables. They block all network calls except the current invocation's
   site-scoped Netlify Blobs endpoint. Rankings are supplied by the synthetic fixture;
   only compare_players, get_player_profile and get_lineup_recommendation tool calls
   are enabled. Other methods still pass through the existing protocol/auth handler.
   No paid provider keys, allowances or budget resets are used.
5. Do not disable secret scanning. Inspect build.json: it must identify the intended
   commit, clean tracked source, correct site/origin and synthetic fixture provenance.

## Manual publish (account owner)

Use a checkout of the infrastructure branch and install the existing package dependencies.
The Netlify connector available to this session has no deployment-upload operation;
no account credentials should be given to the assistant.

```sh
npm ci
npm install --global netlify-cli
netlify login
SAGE_ACCEPTANCE_MODE=isolated \
SAGE_ACCEPTANCE_SITE_ID=dcdb8384-114c-4f80-a2fe-acc0ecb39d57 \
SAGE_ACCEPTANCE_ORIGIN=https://sprightly-chebakia-13d478.netlify.app \
SITE_ID=dcdb8384-114c-4f80-a2fe-acc0ecb39d57 \
node scripts/prepare-sage-acceptance.js
cd .sage-acceptance
netlify deploy --prod --site dcdb8384-114c-4f80-a2fe-acc0ecb39d57 --config netlify.toml --dir public --functions functions
```

Here --prod publishes only the separate acceptance site's stable origin. It must never
be run without the explicit test site ID. .netlify and .sage-acceptance are ignored.
The original repository configuration is not used by this artifact.

## First live checks and ChatGPT connection

First verify the public manifest and both metadata routes. All identity/endpoint URLs
must point to this test origin. An unauthenticated tools/call must return 401.
Then create the private ChatGPT custom MCP connection using OAuth, authorize without
connecting a league, refresh its tool metadata and use a new conversation. Tokens stay
inside the normal OAuth flow. Confirm authenticated comparison and missing-context
lineup calls; inspect logs without logging Authorization headers or token bodies.

## Candidate acceptance remains separate

The included synthetic Week 7 fixture proves plumbing only. It is not a claim about
current player teams, injuries, rankings, scoring or historical benchmark accuracy.
Do not grade either repair against it as verified real football evidence.

For each candidate, record the original PR head, infrastructure commit, final combined
candidate commit, fixture hash, Netlify deploy ID and sourceCommit in build.json.
Never call an infrastructure-overlay candidate the unchanged original PR commit.
Keep #324 and #326 separate; do not combine their repairs. Rerun the full suite on
each exact candidate. Load frozen verified public football evidence with provenance
before real benchmark acceptance; do not copy production auth or league stores.

#324: Mason/Kamara IR explanation and starter exclusion, plus an unchanged active
control recommendation. #326: both Bourne/Hockenson orders, missing-context clarification,
then explicit synthetic league/roster context through the shared lineup authority;
preserve scoring, outside-analysis restrictions and same-position completion.
Neither repair is accepted until an actual authenticated ChatGPT conversation passes.
