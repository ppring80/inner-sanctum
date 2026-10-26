"use strict";
// Trusted orchestration only. Never import candidate code or candidate artifacts.
const fs = require("node:fs");
const REPO = "ppring80/inner-sanctum";
const SITE = "dcdb8384-114c-4f80-a2fe-acc0ecb39d57";
const SLUG = "sprightly-chebakia-13d478";
const ORIGIN = "https://" + SLUG + ".netlify.app";
const BRANCH = "acceptance/test-sanctum";
const ACCEPTED = {
  sha: "48a2604bad557072fe244fdc0c50e28569ce3707",
  deploymentId: "6add7ec57d21cee22e7804a6",
};
class Stop extends Error {
  constructor(category, result = "BLOCKED") {
    super(category);
    this.category = category;
    this.result = result;
  }
}
function approved(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || ""))
    throw new Stop("INVALID_CANDIDATE_SHA");
  return sha;
}
function trusted(env) {
  if (
    env.GITHUB_REPOSITORY !== REPO ||
    env.GITHUB_REF !== "refs/heads/main" ||
    !["workflow_dispatch", "issue_comment"].includes(env.GITHUB_EVENT_NAME)
  )
    throw new Stop("UNTRUSTED_WORKFLOW_CONTEXT");
  if (
    env.GITHUB_EVENT_NAME === "issue_comment" &&
    (env.GITHUB_ACTOR !== "ppring80" || env.REQUEST_VERIFIED !== "true")
  )
    throw new Stop("UNVERIFIED_OWNER_REQUEST");
  approved(env.TRUSTED_WORKFLOW_SHA);
  if (!["promote", "recover"].includes(env.OPERATION || "promote"))
    throw new Stop("INVALID_OPERATION");
  if (env.OPERATION === "recover" && env.CANDIDATE_SHA !== ACCEPTED.sha)
    throw new Stop("INVALID_RECOVERY_SHA");
}
async function resolveRequest(env, event, fetcher = fetch) {
  if (env.GITHUB_REPOSITORY !== REPO || env.GITHUB_REF !== "refs/heads/main")
    throw new Stop("UNTRUSTED_WORKFLOW_CONTEXT");
  let sha, operation;
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    sha = approved(event.inputs?.candidate_sha);
    operation = event.inputs?.operation || "promote";
  } else if (env.GITHUB_EVENT_NAME === "issue_comment") {
    if (
      event.action !== "created" ||
      env.GITHUB_ACTOR !== "ppring80" ||
      event.comment?.user?.login !== "ppring80" ||
      event.comment?.author_association !== "OWNER" ||
      !event.issue?.pull_request ||
      !Number.isSafeInteger(event.issue.number)
    )
      throw new Stop("UNAUTHORIZED_REQUEST");
    const match = event.comment.body
      ?.trim()
      .match(/^\/test-sanctum(?: (recover))? ([a-f0-9]{40})$/);
    if (!match) throw new Stop("INVALID_REQUEST_COMMAND");
    sha = match[2];
    operation = match[1] || "promote";
    let response;
    try {
      response = await fetcher(
        "https://api.github.com/repos/" + REPO + "/pulls/" + event.issue.number,
        {
          redirect: "error",
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: "Bearer " + env.REQUEST_TOKEN,
            Accept: "application/vnd.github+json",
          },
        },
      );
    } catch {
      throw new Stop("REQUEST_METADATA_UNAVAILABLE");
    }
    if (!response.ok) throw new Stop("REQUEST_METADATA_UNAVAILABLE");
    const pr = await response.json();
    if (pr.head?.repo?.full_name !== REPO || pr.head?.sha !== sha)
      throw new Stop("PR_HEAD_MISMATCH");
  } else throw new Stop("UNTRUSTED_WORKFLOW_CONTEXT");
  trusted({
    ...env,
    CANDIDATE_SHA: sha,
    OPERATION: operation,
    REQUEST_VERIFIED: "true",
  });
  return { sha, operation, verified: "true" };
}
function hookUrl(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw new Stop("TEST_HOOK_NOT_CONFIGURED");
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== "api.netlify.com" ||
    u.port ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !/^\/build_hooks\/[a-f0-9]{24}$/.test(u.pathname)
  )
    throw new Stop("INVALID_TEST_HOOK");
  return u;
}
function deployId(url) {
  try {
    const u = new URL(url);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash
    )
      return null;
    const immutable = u.hostname.match(
      new RegExp("^([a-f0-9]{24})--" + SLUG + "\\.netlify\\.app$"),
    );
    if (immutable && u.pathname === "/") return immutable[1];
    if (u.hostname !== "app.netlify.com") return null;
    return (
      u.pathname.match(
        new RegExp(
          "^/(?:sites|projects)/" + SLUG + "/deploys/([a-f0-9]{24})/?$",
        ),
      )?.[1] || null
    );
  } catch {
    return null;
  }
}
function latestNetlify(checks, statuses) {
  const entries = [];
  for (const c of checks || []) {
    const id = deployId(c.details_url);
    if (c.app?.slug === "netlify" && id)
      entries.push({
        id,
        when: Date.parse(c.completed_at || c.started_at || c.created_at),
        state:
          c.status === "completed"
            ? c.conclusion === "success"
              ? "ready"
              : "failed"
            : "pending",
      });
  }
  for (const s of statuses || []) {
    const id = deployId(s.target_url);
    if (id && ["netlify", "netlify[bot]"].includes(s.creator?.login))
      entries.push({
        id,
        when: Date.parse(s.updated_at || s.created_at),
        state:
          s.state === "success"
            ? "ready"
            : s.state === "pending"
              ? "pending"
              : "failed",
      });
  }
  return (
    entries
      .filter((x) => Number.isFinite(x.when))
      .sort((a, b) => b.when - a.when)[0] || null
  );
}
function manifest(m, sha) {
  return (
    m?.siteId === SITE &&
    m?.origin === ORIGIN &&
    m?.sourceCommit === sha &&
    m?.sourceDirty === false &&
    m?.fixture?.kind === "synthetic"
  );
}
function baseReport(sha) {
  return {
    candidateSha: /^[a-f0-9]{40}$/.test(sha || "") ? sha : null,
    siteId: SITE,
    branch: BRANCH,
    phase1: "BLOCKED",
    deployment: "NOT_STARTED",
    authenticatedHostedAcceptance: "BLOCKED",
    productionRelease: "NOT_AUTHORIZED",
    reason: "NOT_STARTED",
    acceptedRecovery: ACCEPTED,
  };
}
async function execute(
  env,
  {
    fetcher = fetch,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  const report = baseReport(env.CANDIDATE_SHA);
  let mutated = false;
  async function request(url, options = {}, git = false) {
    let r;
    try {
      r = await fetcher(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          ...(git
            ? {
                Authorization: "Bearer " + env.GH_TOKEN,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
              }
            : {}),
          ...options.headers,
        },
      });
    } catch {
      throw new Stop(
        options.method === "POST" && !git
          ? "HOOK_RESULT_UNKNOWN"
          : "NETWORK_UNAVAILABLE",
      );
    }
    if (!r.ok) {
      if (r.status === 401 || r.status === 403)
        throw new Stop("PERMISSION_DENIED");
      throw new Stop("REMOTE_REQUEST_FAILED");
    }
    try {
      return await r.json();
    } catch {
      throw new Stop("INVALID_REMOTE_RESPONSE");
    }
  }
  const api = (p, o = {}) =>
    request("https://api.github.com/repos/" + REPO + p, o, true);
  const ref = () => api("/git/ref/heads/" + BRANCH);
  async function evidence(sha) {
    const [c, s] = await Promise.all([
      api("/commits/" + sha + "/check-runs?per_page=100"),
      api("/commits/" + sha + "/statuses?per_page=100"),
    ]);
    return latestNetlify(c.check_runs, s);
  }
  try {
    trusted(env);
    const sha = approved(env.CANDIDATE_SHA);
    if (
      env.PHASE1_ENABLED !== "true" ||
      !env.GH_TOKEN ||
      env.HOOK_APPROVED_SITE_ID !== SITE
    )
      throw new Stop("ONE_TIME_SETUP_REQUIRED");
    const hook = hookUrl(env.TEST_BUILD_HOOK);
    const commit = await api("/commits/" + sha);
    if (commit.sha !== sha) throw new Stop("CANDIDATE_SHA_MISMATCH", "FAIL");
    // Prevent the ref update from creating a second automatic Git deploy.
    if (
      env.OPERATION !== "recover" &&
      !/\[skip (?:netlify|ci)\]/i.test(commit.commit?.message || "")
    )
      throw new Stop("CANDIDATE_REQUIRES_NETLIFY_SKIP_MARKER");
    const before = await request(ORIGIN + "/build.json");
    if (
      !manifest(before, before.sourceCommit) ||
      !/^[a-f0-9]{40}$/.test(before.sourceCommit)
    )
      throw new Stop("CURRENT_TEST_DEPLOYMENT_UNVERIFIED");
    report.previousPublishedSha = before.sourceCommit;
    const current = await ref();
    if (
      current.ref !== "refs/heads/" + BRANCH ||
      current.object?.sha !== before.sourceCommit
    )
      throw new Stop("PREVIOUS_DEPLOYMENT_UNSETTLED");
    if (
      before.sourceCommit !== ACCEPTED.sha &&
      (await evidence(before.sourceCommit))?.state !== "ready"
    )
      throw new Stop("PREVIOUS_DEPLOYMENT_UNVERIFIED");
    if (current.object.sha === sha)
      throw new Stop("CANDIDATE_ALREADY_PUBLISHED");
    const start = now();
    await api("/git/refs/heads/" + BRANCH, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha, force: true }),
    });
    mutated = true;
    if ((await ref()).object?.sha !== sha)
      throw new Stop("TEST_BRANCH_CHANGED", "FAIL");
    hook.searchParams.set("trigger_branch", BRANCH);
    hook.searchParams.set("trigger_title", "Phase 1 candidate " + sha);
    report.deployment = "TRIGGERED";
    await request(hook.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvedCandidateSha: sha, siteId: SITE }),
    });
    const deadline = start + 600000;
    let sawReady = false;
    while (now() < deadline) {
      if ((await ref()).object?.sha !== sha)
        throw new Stop("TEST_BRANCH_CHANGED", "FAIL");
      const [m, e] = await Promise.all([
        request(ORIGIN + "/build.json"),
        evidence(sha),
      ]);
      if (e?.when >= start - 1000 && e.state === "failed")
        throw new Stop("NETLIFY_DEPLOYMENT_FAILED", "FAIL");
      if (e?.when >= start - 1000 && e.state === "ready") sawReady = true;
      if (e?.when >= start - 1000 && e.state === "ready" && manifest(m, sha)) {
        report.phase1 = "PASS";
        report.deployment = "PASS";
        report.reason = "PUBLISHED_SHA_AND_NETLIFY_READY_VERIFIED";
        report.deploymentId = e.id;
        report.readyEvidence = "NETLIFY_GITHUB_DEPLOY_SUCCESS";
        return report;
      }
      await sleep(10000);
    }
    throw new Stop(
      sawReady ? "HOSTED_SHA_MISMATCH" : "READY_EVIDENCE_TIMEOUT",
      sawReady ? "FAIL" : "BLOCKED",
    );
  } catch (error) {
    report.phase1 = error instanceof Stop ? error.result : "BLOCKED";
    report.reason =
      error instanceof Stop ? error.category : "INTERNAL_AUTOMATION_ERROR";
    if (report.deployment === "TRIGGERED" && report.phase1 === "FAIL")
      report.deployment = "FAIL";
    if (mutated && report.deployment === "NOT_STARTED")
      report.deployment = "PROMOTED_NOT_TRIGGERED";
    return report;
  }
}
function consolidated(env) {
  let promotion = null;
  try {
    promotion = JSON.parse(env.PROMOTION_REPORT || "null");
  } catch {}
  const r = promotion || baseReport(env.CANDIDATE_SHA);
  if (!promotion) r.reason = "PROMOTION_REPORT_UNAVAILABLE";
  r.validationMode =
    env.OPERATION === "recover"
      ? "ACCEPTED_RECOVERY_BASELINE"
      : "FULL_CANDIDATE_CHECKS";
  if (env.REQUEST_RESULT && env.REQUEST_RESULT !== "success") {
    r.phase1 = "BLOCKED";
    r.reason = "INVALID_OR_UNAUTHORIZED_REQUEST";
    r.validation = "NOT_RUN";
    return r;
  }
  r.validation = env.VALIDATION_RESULT === "success" ? "PASS" : "FAIL";
  if (r.validation === "FAIL") {
    r.phase1 = "FAIL";
    r.reason = "CANDIDATE_VALIDATION_FAILED";
  }
  return r;
}
function markdown(r) {
  return `# Test Sanctum Phase 1: ${r.phase1}\n\n| Check | Result |\n|---|---|\n| Candidate validation | ${r.validation || "PASS"} |\n| Deployment | ${r.deployment} |\n| Authenticated hosted acceptance | **BLOCKED — excluded from Phase 1** |\n| Production release | NOT AUTHORIZED |\n\nCandidate: \`${r.candidateSha || "INVALID"}\`\n\nReason: \`${r.reason}\`\n\nDeployment ID: \`${r.deploymentId || "unverified"}\`\n\nRecovery checkpoint: \`${ACCEPTED.deploymentId}\`, SHA \`${ACCEPTED.sha}\`. No storage rollback or production changes.\n`;
}
module.exports = {
  execute,
  resolveRequest,
  consolidated,
  markdown,
  approved,
  trusted,
  hookUrl,
  deployId,
  latestNetlify,
  manifest,
  REPO,
  SITE,
  ORIGIN,
  BRANCH,
  ACCEPTED,
};
if (require.main === module)
  (async () => {
    if (process.argv.includes("--resolve")) {
      try {
        const r = await resolveRequest(
          process.env,
          JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
        );
        for (const [k, v] of Object.entries(r))
          fs.appendFileSync(process.env.GITHUB_OUTPUT, k + "=" + v + "\n");
      } catch {
        console.log("BLOCKED: invalid or unauthorized candidate request");
        process.exitCode = 1;
      }
    } else if (process.argv.includes("--report")) {
      const r = consolidated(process.env);
      fs.writeFileSync("phase1-report.json", JSON.stringify(r, null, 2));
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY || "phase1-summary.md",
        markdown(r),
      );
      process.exitCode = r.phase1 === "PASS" ? 0 : 1;
    } else {
      const r = await execute(process.env);
      if (process.env.GITHUB_OUTPUT)
        fs.appendFileSync(
          process.env.GITHUB_OUTPUT,
          "report=" + JSON.stringify(r) + "\n",
        );
      console.log(JSON.stringify(r));
      process.exitCode = r.phase1 === "PASS" ? 0 : 1;
    }
  })();
