const { getStore, connectLambda } = require("@netlify/blobs");

// ═══════════════════════════════════════
// SPEND DASHBOARD (added — checklist #114)
// Reads the last 7 days of spend logged by chat.js into Netlify Blobs
// and renders a small HTML page: today's total, a 7-day table, and a
// visual marker against the $50/day threshold discussed for #114.
//
// ACCESS: this endpoint has no login. It's reachable by anyone who
// knows the URL (theinnersanctum.xyz/.netlify/functions/spend-dashboard),
// same security model as the Acolyte passcode gate — obscurity, not
// real auth. The data here (aggregate daily $ totals, no user-level
// detail) is low-sensitivity, but if that changes, add a passcode
// gate matching the one already in auction.html/tiers.html.
//
// NOT an email alert — per the #114 discussion, alerting was
// deliberately deferred until the logging itself is proven accurate
// over a few real days. This page is the manual-check half of #114.
// ═══════════════════════════════════════
const DAILY_THRESHOLD = 50.00;
const SPEND_STORE_NAME = "claude-spend"; // must match chat.js exactly

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "text/html; charset=utf-8"
};

function dateKeyUTC(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderDashboard(days) {
  const today = days[0];
  const todayTotal = today ? today.totalCost : 0;
  const overThreshold = todayTotal >= DAILY_THRESHOLD;
  const pctOfThreshold = Math.min(100, Math.round((todayTotal / DAILY_THRESHOLD) * 100));

  const rows = days.map((day) => {
    if (!day) return "";
    const personaBreakdown = Object.entries(day.byPersona || {})
      .map(([p, c]) => `${escapeHtml(p)}: $${c.toFixed(4)}`)
      .join(" · ");
    const rowOver = day.totalCost >= DAILY_THRESHOLD;
    return `
      <tr style="${rowOver ? "background:#3a1414;" : ""}">
        <td style="padding:10px 14px;border-bottom:1px solid #2a2018;font-family:'JetBrains Mono',monospace;font-size:13px;color:#e0d0b0;">${escapeHtml(day.date)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #2a2018;font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:600;color:${rowOver ? "#ff6666" : "#c9a84c"};">$${day.totalCost.toFixed(4)}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #2a2018;font-family:'JetBrains Mono',monospace;font-size:12px;color:#8a7860;">${day.requestCount}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #2a2018;font-size:11px;color:#7a6a3a;">${personaBreakdown || "—"}</td>
      </tr>`;
  }).join("");

  const weekTotal = days.reduce((sum, d) => sum + (d ? d.totalCost : 0), 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Claude Spend — The Inner Sanctum</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:linear-gradient(160deg,#1a0f08,#221208);min-height:100vh;font-family:'JetBrains Mono',monospace;padding:32px 20px;color:#e0d0b0}
  .wrap{max-width:680px;margin:0 auto}
  h1{font-family:'Cinzel',serif;font-size:22px;color:#f0e0b0;margin-bottom:4px;letter-spacing:1px}
  .sub{font-size:12px;color:#8a7860;margin-bottom:28px;letter-spacing:1px}
  .today-card{background:rgba(0,0,0,0.35);border:1px solid ${overThreshold ? "rgba(255,82,82,0.5)" : "rgba(201,168,76,0.3)"};border-radius:14px;padding:24px;margin-bottom:24px}
  .today-label{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7a6a3a;margin-bottom:8px}
  .today-val{font-size:36px;font-weight:600;color:${overThreshold ? "#ff6666" : "#c9a84c"};margin-bottom:14px}
  .bar-track{background:rgba(255,255,255,0.06);border-radius:6px;height:10px;overflow:hidden;margin-bottom:8px}
  .bar-fill{height:100%;border-radius:6px;background:${overThreshold ? "#ff5252" : pctOfThreshold > 70 ? "#e8960a" : "#4caf50"};width:${pctOfThreshold}%;transition:width 0.3s}
  .threshold-note{font-size:11px;color:#7a6a3a}
  table{width:100%;border-collapse:collapse;background:rgba(0,0,0,0.25);border-radius:10px;overflow:hidden}
  th{text-align:left;padding:10px 14px;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#7a6a3a;border-bottom:1px solid rgba(201,168,76,0.2)}
  .week-total{margin-top:16px;font-size:12px;color:#8a7860;text-align:right}
  .week-total strong{color:#c9a84c}
  .footnote{margin-top:24px;font-size:10px;color:#5a4a30;line-height:1.6}
</style>
</head>
<body>
<div class="wrap">
  <h1>🔮 Claude API Spend</h1>
  <div class="sub">The Inner Sanctum · all personas, chat.js only · UTC days</div>

  <div class="today-card">
    <div class="today-label">Today (${escapeHtml(dateKeyUTC(0))})</div>
    <div class="today-val">$${todayTotal.toFixed(4)}</div>
    <div class="bar-track"><div class="bar-fill"></div></div>
    <div class="threshold-note">${pctOfThreshold}% of $${DAILY_THRESHOLD.toFixed(2)}/day threshold${overThreshold ? " — THRESHOLD CROSSED" : ""}</div>
  </div>

  <table>
    <thead><tr><th>Date</th><th>Total $</th><th>Requests</th><th>By Persona</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="week-total">7-day total: <strong>$${weekTotal.toFixed(4)}</strong></div>

  <div class="footnote">
    Logged from real Anthropic usage.input_tokens/output_tokens on every chat.js response — not an estimate.
    Sonnet 4.6 @ $3/M input, $15/M output. No email alert wired yet (manual-check only, per checklist #114) —
    revisit once this data's been observed for a few real days. This page has no login; treat the URL as
    semi-private. Days with no traffic simply won't appear below.
  </div>
</div>
</body>
</html>`;
}

exports.handler = async (event) => {
  // Required for Netlify Blobs to work in this function's runtime mode —
  // see the matching note in chat.js. Must come before getStore() below.
  connectLambda(event);

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS_HEADERS, body: "" };
  }

  try {
    const store = getStore({ name: SPEND_STORE_NAME });

    // Pull the last 7 UTC days. Missing days (no traffic that day, or
    // before logging existed) come back null from store.get and are
    // filtered out before rendering rows, but still counted as $0 in
    // the week total via the `d ? d.totalCost : 0` guard above.
    const days = [];
    for (let i = 0; i < 7; i++) {
      const key = `daily:${dateKeyUTC(i)}`;
      let day = null;
      try {
        day = await store.get(key, { type: "json" });
      } catch (e) {
        day = null;
      }
      days.push(day);
    }

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: renderDashboard(days)
    };
  } catch (err) {
    console.log("Dashboard handler error:", err.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: `<p style="font-family:monospace;color:#ff6666;padding:20px">Dashboard error: ${escapeHtml(err.message)}</p>`
    };
  }
};
