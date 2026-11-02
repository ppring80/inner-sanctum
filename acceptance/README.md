# SAGE acceptance environment — issue #325

This is a separate Git-connected acceptance project. Connect only its dedicated
branch using acceptance/netlify.toml. Never select main, publish the repository
root, or use the production root netlify.toml. No CLI installation is required.
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
2. Connect only the dedicated acceptance branch, with Base directory set to
   acceptance BEFORE the first build. No plugins, integrations or build hooks should
   inject credentials. Do not copy production settings. If the linking wizard cannot
   select the base/configuration before starting a build, stop without completing
   the link; do not let it build the root configuration.
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

## GitHub continuous deployment (account owner)

The configuration is committed at acceptance/netlify.toml. Set Base directory to acceptance in the repository-linking wizard. Netlify selects
acceptance/netlify.toml from that base before the root configuration. No Package
directory field is required. Its selection is essential:
UI publish/functions overrides alone are not safe because file settings take precedence.
The generated .sage-acceptance/netlify.toml is for manual artifact use, not Git startup.

Open https://app.netlify.com/projects/sprightly-chebakia-13d478 and go to
Project configuration > Developer settings > Continuous deployment > Repository >
Link repository. Authorize the existing Netlify GitHub App as needed; do not change
permissions or settings of the production Netlify project.

Before completing the link or allowing the first build, confirm these settings:

| Setting | Value |
| --- | --- |
| Repository | ppring80/inner-sanctum |
| Production branch of this TEST project | infra/sage-acceptance-325 |
| Base directory | acceptance |
| Package directory | Leave unset / not required |
| Configuration file selected | acceptance/netlify.toml |
| Build command | cd .. && node scripts/prepare-sage-acceptance.js && npm install --ignore-scripts --omit=dev --no-audit --no-fund 1>&2 |
| Publish directory | ../.sage-acceptance/public |
| Functions directory | ../.sage-acceptance/functions |
| Node version | 24 (set in the acceptance file) |
| Additional branch deploys | None |
| Deploy Previews | Disabled for this test project |

The Package directory field may be absent. Set Base directory to acceptance;
confirm the command and relative output paths above. If Base directory is also
absent, stop before the final confirmation; do not rely on changing them after a default-root deployment.
The build runs from acceptance, changes to the repository root, and validates site
identity and credentials before generating the package or installing the existing
root package.json dependencies. npm lifecycle scripts are disabled. Dependencies
are installed on Netlify, not on your computer. All publish/functions/include paths
are relative to acceptance and resolve only into the generated .sage-acceptance tree.
The root netlify.toml is not changed, copied into the package, or selected. The explicit
ignore command (exit 1) ensures changes to shared sources outside acceptance still
trigger a build on this project's permitted branch.

The word production in this project's branch/context labels refers only to the
acceptance site's stable URL, not the actual Inner Sanctum production site.

The acceptance file supplies three PUBLIC build-time settings: isolated mode,
test site ID and test origin. Netlify supplies SITE_ID; do not override it. The
existing generator validates the actual site ID and embeds the public settings
in its two function wrappers. No provider keys or private customer data are needed.
Do not add secret-scanning exclusions or copy the root context.production block.

After the configuration is approved, use Deploys > Trigger deploy. Commit messages
on the infrastructure branch currently include [skip netlify], so use the explicit
dashboard trigger for the first build. Keep the PR title's [skip netlify] marker to
avoid previews on the existing production project. Future unmarked pushes can
publish automatically ONLY on the configured test project/branch; for deliberate
candidate acceptance, hold the branch fixed until its deployment SHA is recorded.

The first live deploy is still an acceptance check, not an assumed success. Confirm
in its build log that the selected config is acceptance/netlify.toml, base is acceptance, publish resolves to
.sage-acceptance/public at repository root, functions resolves to .sage-acceptance/functions, and only chatgpt-mcp
and chatgpt-oauth are deployed. Confirm there are no scheduled functions and the
public build.json matches the expected clean commit/site/origin. No deploy has
been authorized by the configuration-verification task itself.

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
