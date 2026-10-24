#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { assertIsolated } = require("../acceptance/runtime");

function prepare(root, env = process.env) {
  const config = assertIsolated(env);
  const out = path.join(root, ".sage-acceptance");
  const fixture = JSON.parse(fs.readFileSync(path.join(root, "acceptance/football-fixture.json"), "utf8"));
  if (fixture.provenance.kind !== "synthetic") throw new Error("Only reviewed synthetic plumbing fixture packaged by this build");
  fs.rmSync(out, { recursive: true, force: true });
  for (const dir of ["public", "functions", "lib/acceptance", "lib/netlify/functions"]) fs.mkdirSync(path.join(out, dir), { recursive: true });
  fs.cpSync(path.join(root, "netlify/functions"), path.join(out, "lib/netlify/functions"), { recursive: true });
  // Preserve ../../player-identity imports without copying the public website.
  fs.copyFileSync(path.join(root, "player-identity.js"), path.join(out, "lib/player-identity.js"));
  fs.copyFileSync(path.join(root, "acceptance/runtime.js"), path.join(out, "lib/acceptance/runtime.js"));
  fs.copyFileSync(path.join(root, "acceptance/football-fixture.json"), path.join(out, "lib/acceptance/football-fixture.json"));
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const manifest = { sourceCommit: sha, sourceDirty: !!execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root, encoding: "utf8" }).trim(), siteId: env.SAGE_ACCEPTANCE_SITE_ID, origin: config.issuer, fixture: fixture.provenance };
  fs.writeFileSync(path.join(out, "public/build.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(out, "public/index.html"), '<!doctype html><title>SAGE acceptance test</title><h1>SAGE acceptance test</h1><p>Synthetic frozen evidence. Not current football advice. No connected customer leagues.</p>');
  fs.writeFileSync(path.join(out, "public/_headers"), '/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n');
  fs.writeFileSync(path.join(out, "public/_redirects"), '/.well-known/oauth-protected-resource /.netlify/functions/chatgpt-oauth?action=protected-resource 200\n/.well-known/oauth-authorization-server /.netlify/functions/chatgpt-oauth?action=authorization-server 200\n');
  const settings = JSON.stringify({ SAGE_ACCEPTANCE_MODE: "isolated", SAGE_ACCEPTANCE_SITE_ID: env.SAGE_ACCEPTANCE_SITE_ID, SAGE_ACCEPTANCE_ORIGIN: config.issuer });
  for (const endpoint of ["chatgpt-mcp", "chatgpt-oauth"]) {
    fs.writeFileSync(path.join(out, "functions", endpoint + ".js"), `"use strict";
const settings = ${settings};
for (const [key,value] of Object.entries(settings)) {
  if (process.env[key] && process.env[key] !== value) throw new Error("Acceptance configuration mismatch");
  process.env[key] = value;
}
const { assertIsolated } = require("../lib/acceptance/runtime");
assertIsolated(process.env);
const fixture = require("../lib/acceptance/football-fixture.json");
let blobOrigin;
const networkFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin === settings.SAGE_ACCEPTANCE_ORIGIN && url.pathname === "/.netlify/functions/weekly-sage-rankings") {
    if (url.searchParams.get("season") !== String(fixture.provenance.season) || url.searchParams.get("week") !== String(fixture.provenance.week))
      return new Response(JSON.stringify({error:"fixture_period_unavailable"}), {status:404});
    return Response.json(fixture.rankings);
  }
  if (blobOrigin && url.origin === blobOrigin && url.pathname.split("/").includes(settings.SAGE_ACCEPTANCE_SITE_ID))
    return networkFetch(input, {...options, redirect:"error"});
  throw new Error("Acceptance network access blocked");
};
const handler = require("../lib/netlify/functions/${endpoint}").handler;
exports.handler = async (event, context) => {
  assertIsolated(process.env, event);
  const blobs = JSON.parse(Buffer.from(event.blobs, "base64").toString("utf8"));
  const url = new URL(blobs.url);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".netlify.com")) throw new Error("Untrusted Blobs endpoint");
  blobOrigin = url.origin;
  const rpc = event.httpMethod === "POST" && event.body ? (() => { try { return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body,"base64").toString("utf8") : event.body); } catch { return null; } })() : null;
  if (rpc?.method === "tools/call" && !["compare_players", "get_player_profile", "get_lineup_recommendation"].includes(rpc.params?.name))
    return {statusCode:403, body:JSON.stringify({error:"acceptance_tool_not_enabled"})};
  return handler(event, context);
};
`);
  }
  // This artifact has no schedules, refresh endpoints, repository public files, or Git auto-deploy settings.
  fs.writeFileSync(path.join(out, "netlify.toml"), '[build]\n  publish = "public"\n  functions = "functions"\n[functions]\n  node_bundler = "esbuild"\n  included_files = ["lib/**"]\n');
  return { out, manifest };
}
if (require.main === module) console.log(JSON.stringify(prepare(path.resolve(__dirname, ".."))));
module.exports = { prepare };
