const { connectLambda, getStore } = require("@netlify/blobs");

// ═══════════════════════════════════════
// QA FACT-CHECK DASHBOARD
//
// Read-only view of qa-fact-check.js's results, same idea as
// spend-dashboard.js but for accuracy instead of cost. Shows the
// latest run's pass rate plus every individual sample (question,
// ground truth, response, verdict, reasoning) so a FAIL can be
// reviewed and understood, not just counted.
//
// Visit /.netlify/functions/qa-dashboard directly in a browser.
// ═══════════════════════════════════════

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderResultCard(r) {
  const verdict = r.verdict || {};
  let statusLabel, statusColor;
  if (verdict.pass === true) { statusLabel = "✅ PASS"; statusColor = "#4caf50"; }
  else if (verdict.pass === false) { statusLabel = "❌ FAIL"; statusColor = "#ff5252"; }
  else { statusLabel = "⚠️ ERROR"; statusColor = "#ffc107"; }

  return `
    <div style="background:rgba(0,0,0,0.3);border:1px solid ${statusColor}44;border-left:4px solid ${statusColor};border-radius:10px;padding:16px 18px;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
        <strong style="color:#f0e0b0;font-size:15px;">${escapeHtml(r.name)}</strong>
        <span style="color:${statusColor};font-weight:bold;font-size:13px;">${statusLabel}</span>
      </div>
      <div style="font-size:11px;color:#7a6a3a;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">
        ${escapeHtml(r.category)} · persona: ${escapeHtml(r.persona)}
      </div>
      <div style="font-size:13px;color:#a08a5a;margin-bottom:6px;"><strong>Ground truth:</strong> ${escapeHtml(r.groundTruth)}</div>
      <div style="font-size:13px;color:#a08a5a;margin-bottom:6px;"><strong>Question:</strong> ${escapeHtml(r.question)}</div>
      <div style="font-size:13px;color:#c8b890;margin-bottom:6px;"><strong>Response:</strong> ${escapeHtml(r.response) || "<em>(no response — run error)</em>"}</div>
      <div style="font-size:13px;color:${statusColor};margin-top:8px;"><strong>Verdict reasoning:</strong> ${escapeHtml(verdict.reasoning)}</div>
    </div>`;
}

exports.handler = async (event) => {
  connectLambda(event);

  let latest = null;
  try {
    const store = getStore({ name: "qa-fact-check" });
    latest = await store.get("latest", { type: "json" });
  } catch (e) {
    // fall through to "no data" view below
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QA Fact-Check Dashboard — The Inner Sanctum</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { min-height: 100vh; background: linear-gradient(160deg, #1a0f08 0%, #221208 40%, #261018 100%); font-family: Georgia, serif; color: #d0c0a0; padding: 30px 20px; }
  .wrap { max-width: 800px; margin: 0 auto; }
  h1 { color: #f0e0b0; font-size: 26px; margin-bottom: 4px; }
  .sub { color: #c9a84c; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 24px; }
  .summary { display: flex; gap: 14px; margin-bottom: 28px; flex-wrap: wrap; }
  .stat { background: rgba(0,0,0,0.35); border: 1px solid rgba(201,168,76,0.25); border-radius: 12px; padding: 16px 20px; flex: 1; min-width: 140px; text-align: center; }
  .stat-num { font-size: 28px; font-weight: bold; color: #f0e0b0; }
  .stat-label { font-size: 11px; color: #a08a5a; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .empty { padding: 40px; text-align: center; color: #7a6a3a; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🔍 QA Fact-Check Dashboard</h1>
  <div class="sub">Automated persona accuracy testing against live player data</div>
  ${!latest ? '<div class="empty">No QA runs found yet. Trigger qa-fact-check manually via Netlify → Functions → Run now, or wait for its daily schedule.</div>' : `
  <div class="summary">
    <div class="stat"><div class="stat-num">${latest.passRate}%</div><div class="stat-label">Pass Rate</div></div>
    <div class="stat"><div class="stat-num" style="color:#4caf50">${latest.passCount}</div><div class="stat-label">Passed</div></div>
    <div class="stat"><div class="stat-num" style="color:#ff5252">${latest.failCount}</div><div class="stat-label">Failed</div></div>
    <div class="stat"><div class="stat-num" style="color:#ffc107">${latest.errorCount}</div><div class="stat-label">Errors</div></div>
  </div>
  <div style="font-size:12px;color:#7a6a3a;margin-bottom:20px;">Last run: ${escapeHtml(latest.runAt)}</div>
  ${latest.results.map(renderResultCard).join("")}
  `}
</div>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html" },
    body: html
  };
};
