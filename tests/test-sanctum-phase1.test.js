"use strict";
const assert = require("node:assert/strict"),
  fs = require("fs"),
  m = require("../scripts/test-sanctum-phase1");
const candidate = "5cc7e03a1bfab2e80f807bd50ac0ba564a4a11e0",
  hook = "https://api.netlify.com/build_hooks/" + "a".repeat(24),
  secret = "SYNTHETIC_GH_SECRET";
const env = {
  CANDIDATE_SHA: candidate,
  TRUSTED_WORKFLOW_SHA: "b".repeat(40),
  GITHUB_REPOSITORY: m.REPO,
  GITHUB_REF: "refs/heads/main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  PHASE1_ENABLED: "true",
  GH_TOKEN: secret,
  HOOK_APPROVED_SITE_ID: m.SITE,
  TEST_BUILD_HOOK: hook,
};
const doc = (sha) => ({
  sourceCommit: sha,
  sourceDirty: false,
  siteId: m.SITE,
  origin: m.ORIGIN,
  fixture: { kind: "synthetic" },
});
function fixture(options = {}) {
  let clock = 100000,
    ref = options.ref || m.ACCEPTED.sha,
    triggered = false;
  const calls = [];
  const response = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  const netlify = {
    app: { slug: "netlify" },
    details_url:
      "https://app.netlify.com/projects/sprightly-chebakia-13d478/deploys/" +
      "c".repeat(24),
    status: "completed",
    conclusion: options.failed ? "failure" : "success",
    completed_at: new Date(clock).toISOString(),
  };
  return {
    calls,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetcher: async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.redirect, "error");
      if (options.throwNetwork) throw Error(hook + secret);
      if (url === m.ORIGIN + "/build.json")
        return response(
          doc(triggered && !options.oldManifest ? candidate : m.ACCEPTED.sha),
        );
      if (
        url.includes("/commits/") &&
        !url.includes("/check-runs") &&
        !url.includes("/statuses")
      )
        return response({
          sha: candidate,
          commit: {
            message: options.unmarked ? "change" : "[skip netlify] candidate",
          },
        });
      if (url.includes("/git/ref/heads/"))
        return response({
          ref: "refs/heads/" + m.BRANCH,
          object: { sha: ref },
        });
      if (init.method === "PATCH") {
        assert.equal(
          url,
          "https://api.github.com/repos/" +
            m.REPO +
            "/git/refs/heads/" +
            m.BRANCH,
        );
        ref = JSON.parse(init.body).sha;
        return response({ object: { sha: ref } });
      }
      if (url.startsWith(hook)) {
        if (options.hookUncertain) throw Error("HOOK_SECRET");
        triggered = true;
        return response({ ok: true });
      }
      if (url.includes("/check-runs"))
        return response({ check_runs: options.noReady ? [] : [netlify] });
      if (url.includes("/statuses")) return response([]);
      throw Error("Unexpected route");
    },
  };
}
(async () => {
  let f = fixture(),
    r = await m.execute(env, f);
  assert.equal(r.phase1, "PASS");
  assert.equal(r.deployment, "PASS");
  assert.equal(r.authenticatedHostedAcceptance, "BLOCKED");
  assert.equal(r.acceptedRecovery.sha, m.ACCEPTED.sha);
  assert.equal(f.calls.filter((c) => c.url.startsWith(hook)).length, 1);
  assert.ok(!JSON.stringify(r).includes(secret));
  assert.ok(!JSON.stringify(r).includes(hook));
  assert.ok(
    f.calls
      .filter((c) => c.init.method === "PATCH")
      .every((c) => c.url.endsWith(m.BRANCH)),
  );
  for (const override of [
    { CANDIDATE_SHA: "main" },
    { GITHUB_REF: "refs/heads/pr-335" },
    { GITHUB_REPOSITORY: "attacker/repo" },
    { GITHUB_EVENT_NAME: "pull_request_target" },
    { TRUSTED_WORKFLOW_SHA: "main" },
    { OPERATION: "recover" },
    { OPERATION: "unsafe" },
    { PHASE1_ENABLED: "" },
    { HOOK_APPROVED_SITE_ID: "production" },
    { TEST_BUILD_HOOK: "https://theinnersanctum.xyz/hook" },
    { TEST_BUILD_HOOK: hook + "?token=secret" },
  ]) {
    f = fixture();
    r = await m.execute({ ...env, ...override }, f);
    assert.equal(r.phase1, "BLOCKED");
    assert.equal(f.calls.length, 0);
  }
  for (const options of [{ unmarked: true }, { ref: "d".repeat(40) }]) {
    f = fixture(options);
    r = await m.execute(env, f);
    assert.equal(r.phase1, "BLOCKED");
    assert.equal(
      f.calls.filter(
        (c) => c.init.method === "PATCH" || c.init.method === "POST",
      ).length,
      0,
    );
  }
  f = fixture({ noReady: true });
  r = await m.execute(env, f);
  assert.equal(r.phase1, "BLOCKED");
  assert.equal(r.reason, "READY_EVIDENCE_TIMEOUT");
  assert.equal(f.calls.filter((c) => c.url.startsWith(hook)).length, 1);
  f = fixture({ oldManifest: true });
  r = await m.execute(env, f);
  assert.equal(r.phase1, "FAIL");
  assert.equal(r.deployment, "FAIL");
  assert.equal(r.reason, "HOSTED_SHA_MISMATCH");
  f = fixture({ failed: true });
  r = await m.execute(env, f);
  assert.equal(r.phase1, "FAIL");
  assert.equal(r.reason, "NETLIFY_DEPLOYMENT_FAILED");
  f = fixture({ hookUncertain: true });
  r = await m.execute(env, f);
  assert.equal(r.phase1, "BLOCKED");
  assert.equal(r.reason, "HOOK_RESULT_UNKNOWN");
  assert.equal(f.calls.filter((c) => c.url.startsWith(hook)).length, 1);
  f = fixture({ throwNetwork: true });
  r = await m.execute(env, f);
  assert.ok(!JSON.stringify(r).includes(secret));
  assert.ok(!JSON.stringify(r).includes(hook));
  assert.equal(
    m.deployId(
      "https://app.netlify.com/projects/delicate-dragon-447881/deploys/" +
        "c".repeat(24),
    ),
    null,
  );
  assert.equal(
    m.manifest({ ...doc(candidate), siteId: "production" }, candidate),
    false,
  );
  assert.equal(
    m.manifest({ ...doc(candidate), sourceDirty: true }, candidate),
    false,
  );
  assert.equal(
    m.latestNetlify(
      [
        {
          app: { slug: "attacker" },
          details_url:
            "https://app.netlify.com/projects/sprightly-chebakia-13d478/deploys/" +
            "c".repeat(24),
          status: "completed",
          conclusion: "success",
          completed_at: new Date().toISOString(),
        },
      ],
      [],
    ),
    null,
  );
  const statusUrl =
    "https://" + "c".repeat(24) + "--sprightly-chebakia-13d478.netlify.app/";
  assert.equal(
    m.latestNetlify(
      [],
      [
        {
          creator: { login: "netlify[bot]" },
          target_url: statusUrl,
          state: "success",
          created_at: new Date().toISOString(),
        },
      ],
    ).state,
    "ready",
  );
  assert.equal(
    m.latestNetlify(
      [],
      [
        {
          creator: { login: "attacker" },
          target_url: statusUrl,
          state: "success",
          created_at: new Date().toISOString(),
        },
      ],
    ),
    null,
  );
  const failed = m.consolidated({
    CANDIDATE_SHA: candidate,
    VALIDATION_RESULT: "failure",
  });
  assert.equal(failed.phase1, "FAIL");
  assert.match(m.markdown(failed), /authenticated hosted acceptance/i);
  assert.equal(failed.authenticatedHostedAcceptance, "BLOCKED");
  const commentEvent = {
    action: "created",
    comment: {
      body: "/test-sanctum " + candidate,
      user: { login: "ppring80" },
      author_association: "OWNER",
    },
    issue: { number: 335, pull_request: {} },
  };
  const requestEnv = {
    ...env,
    GITHUB_EVENT_NAME: "issue_comment",
    GITHUB_ACTOR: "ppring80",
    REQUEST_TOKEN: "SYNTHETIC_READ_TOKEN",
  };
  const prFetch = async () => ({
    ok: true,
    json: async () => ({
      head: { sha: candidate, repo: { full_name: m.REPO } },
    }),
  });
  assert.equal(
    (await m.resolveRequest(requestEnv, commentEvent, prFetch)).sha,
    candidate,
  );
  for (const event of [
    {
      ...commentEvent,
      comment: { ...commentEvent.comment, user: { login: "attacker" } },
    },
    {
      ...commentEvent,
      comment: { ...commentEvent.comment, author_association: "CONTRIBUTOR" },
    },
    {
      ...commentEvent,
      comment: {
        ...commentEvent.comment,
        body: "/test-sanctum " + candidate + "; curl evil",
      },
    },
    { ...commentEvent, action: "edited" },
  ])
    await assert.rejects(() => m.resolveRequest(requestEnv, event, prFetch));
  await assert.rejects(() =>
    m.resolveRequest(requestEnv, commentEvent, async () => ({
      ok: true,
      json: async () => ({
        head: { sha: candidate, repo: { full_name: "attacker/fork" } },
      }),
    })),
  );
  await assert.rejects(() =>
    m.resolveRequest(requestEnv, commentEvent, async () => ({
      ok: true,
      json: async () => ({
        head: { sha: "e".repeat(40), repo: { full_name: m.REPO } },
      }),
    })),
  );
  await assert.rejects(() =>
    m.resolveRequest(
      { ...requestEnv, GITHUB_REF: "refs/heads/evil" },
      commentEvent,
      prFetch,
    ),
  );
  assert.equal(
    (
      await m.resolveRequest(env, {
        inputs: { candidate_sha: candidate, operation: "promote" },
      })
    ).sha,
    candidate,
  );
  assert.throws(() => m.trusted({ ...requestEnv, REQUEST_VERIFIED: "false" }));
  const workflow = fs.readFileSync(
    require("path").join(
      __dirname,
      "../.github/workflows/test-sanctum-phase1.yml",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    workflow,
    /pull_request_target|NETLIFY_AUTH_TOKEN|PERSONAL_ACCESS_TOKEN|download-artifact/,
  );
  assert.match(
    workflow,
    /group: test-sanctum-phase1\n\s+cancel-in-progress: false/,
  );
  assert.equal((workflow.match(/contents: write/g) || []).length, 1);
  assert.equal((workflow.match(/secrets\./g) || []).length, 1);
  const privileged = workflow.slice(
    workflow.indexOf("  promotion:"),
    workflow.indexOf("  report:\n    if: always()"),
  );
  assert.doesNotMatch(
    privileged,
    /ref: \$\{\{ inputs|npm install|working-directory: candidate/,
  );
  assert.match(privileged, /ref: \$\{\{ github.workflow_sha \}\}/);
  assert.match(privileged, /environment: test-sanctum-phase1/);
  assert.match(workflow, /persist-credentials: false/);
  console.log(
    "PASS Phase 1 automation: trusted-job isolation; immutable SHA; fixed test branch/site; READY+manifest proof; one hook; blocked/mismatched/failed deploys; preserved recovery; no secret leakage; hosted authentication always BLOCKED",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
