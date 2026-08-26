const { connectLambda, getStore } = require("@netlify/blobs");

// ═══════════════════════════════════════════════════════════════════
// PLAYER SNAPSHOT V1 — DIAGNOSTIC/READ ENDPOINT (NON-PRODUCTION)
//
// Thin pass-through of the "player-snapshot" Blobs store's "latest"
// key, built by refresh-player-snapshot.js -- mirrors the exact
// pattern already established by netlify/functions/player-data.js
// (same connectLambda/getStore usage, same "read the cache, return it
// as-is" shape). This does not compute anything itself.
//
// TWO OUTPUT MODES, both GET, no auth (matches player-data.js's own
// posture -- this is read-only derived data, not sensitive):
//   ?format=json   (or no format param) -> raw JSON, exactly what's
//                  cached. Useful for scripts/tooling.
//   ?format=html   -> a simple, human-scannable HTML table, sortable
//                  by clicking column headers, so the classifications
//                  can be sanity-checked in a browser without ever
//                  touching raw Blob data by hand. THIS IS NOT
//                  CUSTOMER-FACING UI -- it is a plain, unstyled
//                  internal diagnostic page, not linked from
//                  anywhere in the product, not using the product's
//                  design system, and not exposed to draft.html,
//                  auction.html, Tier List, Weekly Rankings, or
//                  Sanctum in any way.
//
// NO TANK01 CALLS HAPPEN HERE. This function only reads a Blobs
// cache that refresh-player-snapshot.js already populated on its own
// schedule -- exactly the same relationship player-data.js already
// has to refresh-player-data.js's cache.
// ═══════════════════════════════════════════════════════════════════

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDiagnosticHtml(data) {
  if (data.skipped) {
    return `<!DOCTYPE html><html><body style="font-family:monospace;padding:24px">
      <h2>Player Snapshot — no data cached yet</h2>
      <p>${escapeHtml(data.reason || "Unknown reason.")}</p>
      <p>Run refresh-player-snapshot.js first, then reload this page.</p>
    </body></html>`;
  }

  const players = Object.values(data.players || {});
  const rows = players
    .sort((a, b) => (a.team || "").localeCompare(b.team || "") || (a.pos || "").localeCompare(b.pos || ""))
    .map(p => `
      <tr>
        <td>${escapeHtml(p.longName)}</td>
        <td>${escapeHtml(p.pos)}</td>
        <td>${escapeHtml(p.team)}</td>
        <td>${escapeHtml(p.teamRole)}</td>
        <td>${escapeHtml(p.roleDescription)}</td>
        <td class="conf-${escapeHtml(p.roleConfidence || "").toLowerCase()}">${escapeHtml(p.roleConfidence)}</td>
        <td>${escapeHtml(p.offenseStyle)}</td>
        <td>${escapeHtml(p.careerProfile)}</td>
        <td>${escapeHtml(p.availabilityProfile)}</td>
        <td>${p._internal ? (p._internal.avgSnapPct * 100).toFixed(1) + "%" : "—"}</td>
        <td>${p._internal ? (p._internal.avgTargetShare * 100).toFixed(1) + "%" : "—"}</td>
        <td>${p._internal && p.pos === "RB" ? (p._internal.avgRBCarryShare * 100).toFixed(1) + "%" : "—"}</td>
        <td>${p.computedFromGames}</td>
      </tr>`).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Player Snapshot V1 — Diagnostic (Non-Production)</title>
<style>
  body{font-family:-apple-system,Arial,sans-serif;padding:20px;background:#f5f5f5;color:#222}
  h1{font-size:18px}
  .warn{background:#fff3cd;border:1px solid #ffc107;padding:10px 14px;border-radius:4px;margin-bottom:16px;font-size:13px}
  table{border-collapse:collapse;width:100%;background:#fff;font-size:12px}
  th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;white-space:nowrap}
  th{background:#333;color:#fff;position:sticky;top:0;cursor:pointer}
  tr:nth-child(even){background:#fafafa}
  .conf-high{color:#1a7a1a;font-weight:600}
  .conf-medium{color:#a06a00}
  .conf-low{color:#a02020}
  .meta{font-size:12px;color:#555;margin-bottom:14px}
</style>
</head>
<body>
  <h1>Player Snapshot V1 — Diagnostic (NON-PRODUCTION)</h1>
  <div class="warn">Internal diagnostic only. Not linked from any customer-facing page. Descriptions are prototype classifications for sanity-checking, not yet customer-facing product copy.</div>
  <div class="meta">
    Computed: ${escapeHtml(data.computedAt)} · Season ${escapeHtml(data.season)} ·
    Weeks used: ${escapeHtml((data.weeksUsed || []).join(", "))} ·
    Games fetched: ${escapeHtml(data.gamesFetched)} ·
    Players classified: ${escapeHtml(data.playerCount)}
  </div>
  <table id="t">
    <thead><tr>
      <th>Player</th><th>Pos</th><th>Team</th><th>Team Role</th><th>Role Description</th>
      <th>Confidence</th><th>Offensive Style</th><th>Career Profile</th><th>Availability</th>
      <th>Avg Snap %</th><th>Avg Target Share</th><th>Avg RB Carry Share</th><th>Games</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>
    // Trivial click-to-sort, purely for internal inspection convenience.
    document.querySelectorAll('#t th').forEach((th, i) => {
      th.addEventListener('click', () => {
        const tbody = document.querySelector('#t tbody');
        const rowsArr = Array.from(tbody.querySelectorAll('tr'));
        const asc = th.dataset.asc !== 'true';
        rowsArr.sort((a, b) => a.children[i].textContent.localeCompare(b.children[i].textContent, undefined, {numeric:true}) * (asc ? 1 : -1));
        rowsArr.forEach(r => tbody.appendChild(r));
        th.dataset.asc = asc;
      });
    });
  </script>
</body>
</html>`;
}

exports.handler = async (event) => {
  connectLambda(event);

  const params = event.queryStringParameters || {};
  const format = (params.format || "json").toLowerCase();

  let data;
  try {
    const store = getStore({ name: "player-snapshot" });
    data = await store.get("latest", { type: "json" });
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Failed to read player-snapshot cache", detail: e.message }) };
  }

  if (!data) {
    data = { skipped: true, reason: "No Player Snapshot data has been generated yet. Run refresh-player-snapshot.js first." };
  }

  if (format === "html") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
      body: renderDiagnosticHtml(data)
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data, null, 2)
  };
};
