// netlify/functions/mcp.js
//
// MVP MCP server for The Inner Sanctum, exposing a single tool —
// ask_the_oracle — so ChatGPT (via Developer Mode / a connector URL)
// can ask the Oracle a fantasy football question and get back an
// answer plus a link back to theinnersanctum.xyz. This is intentionally
// a thin, low-surface-area first step, not the full branded MCP app.
//
// ── CAVEAT #1 — hand-rolled JSON-RPC, not the official SDK transport ──
// This file implements the MCP JSON-RPC methods (initialize, tools/list,
// tools/call) BY HAND rather than using @modelcontextprotocol/sdk's
// StreamableHTTPServerTransport class. Reason: that transport class is
// built to run against Node's raw http.IncomingMessage/ServerResponse
// (or a framework like Express exposing those), and Netlify Functions
// hand you a Lambda-style `event` object (classic functions, used here)
// — not a raw Node req/res, so the official transport class doesn't
// plug in without an adapter I haven't written or tested.
//
// What's below is a minimal, spec-following implementation of the three
// JSON-RPC methods a single-tool MCP server actually needs. It has NOT
// been tested against a real ChatGPT Developer Mode connection yet —
// treat this as a first draft to deploy and test, not a proven-working
// integration.
//
// ── CAVEAT #2 — this calls your REAL chat.js endpoint, not Anthropic
// directly ─────────────────────────────────────────────────────────
// Earlier draft of this file called the Anthropic API directly, which
// would have bypassed chat.js's live Tank01 context injection (the
// thing that keeps the Oracle from calling a 4th-year veteran a
// "rookie") AND its spend logging to the P&L dashboard. Fixed: this
// version proxies to https://theinnersanctum.xyz/.netlify/functions/chat
// — the same endpoint sanctum.html's frontend calls — so it inherits
// live data, accuracy safeguards, and spend tracking for free, instead
// of being a second place that duplicates "call Anthropic" logic.
//
// chat.js's origin check does an EXACT match against ALLOWED_ORIGINS
// (production default: https://theinnersanctum.xyz). Since this is a
// server-to-server call (not a real browser), there's no browser-set
// Origin header to rely on — so this file sets one explicitly, the
// same value a real page hosted at that origin would send. This isn't
// bypassing any real protection; it's self-authenticating as the site
// calling its own endpoint, the same trust level a real page there
// already has. No ALLOWED_ORIGINS env var change needed since it
// already matches the production default.
//
// Depends on netlify/functions/personas.js (same commit) for the
// Oracle's system prompt text — see that file's own caveat: it's a
// NEW third copy of the prompt until sanctum.html and qa-fact-check.js
// are migrated to import from it too. chat.js itself is persona-agnostic
// — it just relays whatever `system` text the caller sends — so
// personas.js is still the right (and only) place this text needs to
// live for this file's purposes.

const { getPersona } = require('./personas');

const SITE_URL = 'https://theinnersanctum.xyz';
const CHAT_ENDPOINT = `${SITE_URL}/.netlify/functions/chat`;
const MODEL = 'claude-sonnet-5'; // Confirmed correct: chat.js passes through whatever
                                   // model string the caller sends, no server-side override.
const MAX_TOKENS = 300; // Generous headroom — Oracle's own system prompt already caps
                          // itself at ~50 words / 2-3 sentences.

const TOOL_DEFINITION = {
  name: 'ask_the_oracle',
  description:
    "Ask The Oracle — The Inner Sanctum's mystical fantasy football advisor with 38 seasons of wisdom — a fantasy football question. Good for start/sit calls, waiver pickups, trade advice, and general strategy. Uses live current-season data (rosters, injuries, ADP), not just training knowledge. Returns a short, in-character answer plus a link to try the full tool.",
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The fantasy football question to ask the Oracle.'
      }
    },
    required: ['question']
  }
};

async function callOracle(question) {
  const oracle = getPersona('oracle');
  if (!oracle) {
    throw new Error('Oracle persona not found in personas.js');
  }

  const res = await fetch(CHAT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': SITE_URL // see CAVEAT #2 above — required to pass chat.js's origin check
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: oracle.sys,
      messages: [{ role: 'user', content: question }]
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`chat.js returned ${res.status}: ${errText}`);
  }

  const data = await res.json();
  // chat.js's real response shape: { content: [{ type: "text", text: fullText }] }
  const text = data && data.content && data.content[0] && data.content[0].text;
  if (!text) {
    throw new Error('chat.js returned no text content.');
  }
  return text;
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed — MCP requests must be POST.' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jsonRpcError(null, -32700, 'Parse error: invalid JSON'))
    };
  }

  const { id, method, params } = body;

  try {
    if (method === 'initialize') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          jsonRpcResult(id, {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'inner-sanctum-mcp', version: '0.1.0' }
          })
        )
      };
    }

    if (method === 'tools/list') {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jsonRpcResult(id, { tools: [TOOL_DEFINITION] }))
      };
    }

    if (method === 'tools/call') {
      const toolName = params && params.name;
      const args = (params && params.arguments) || {};

      if (toolName !== 'ask_the_oracle') {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(jsonRpcError(id, -32602, `Unknown tool: ${toolName}`))
        };
      }

      const question = (args.question || '').trim();
      if (!question) {
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(jsonRpcError(id, -32602, 'Missing required argument: question'))
        };
      }

      const answer = await callOracle(question);
      const withCta = `${answer}\n\nAsk more at ${SITE_URL}/sanctum — Trash Lord and Analyst also available there.`;

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          jsonRpcResult(id, {
            content: [{ type: 'text', text: withCta }]
          })
        )
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jsonRpcError(id, -32601, `Method not found: ${method}`))
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jsonRpcError(id, -32000, err.message || 'Internal error'))
    };
  }
};
