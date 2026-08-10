// netlify/functions/mcp.js
//
// MVP MCP server for The Inner Sanctum, exposing a single tool —
// ask_the_oracle — so ChatGPT (via Developer Mode / a connector URL)
// can ask the Oracle a fantasy football question and get back an
// answer plus a link back to theinnersanctum.xyz. This is intentionally
// a thin, low-surface-area first step, not the full branded MCP app.
//
// ── IMPORTANT CAVEAT — READ BEFORE DEPLOYING ────────────────────────
// This file implements the MCP JSON-RPC methods (initialize, tools/list,
// tools/call) BY HAND rather than using @modelcontextprotocol/sdk's
// StreamableHTTPServerTransport class. Reason: that transport class is
// built to run against Node's raw http.IncomingMessage/ServerResponse
// (or a framework like Express exposing those), and Netlify Functions
// hand you either a Lambda-style `event` object (classic functions,
// used here) or a Fetch API Request (v2 functions) — neither is a raw
// Node req/res, so the official transport class doesn't plug in without
// an adapter I haven't written or tested.
//
// What's below is a minimal, spec-following implementation of the three
// JSON-RPC methods a single-tool MCP server actually needs. It has NOT
// been tested against a real ChatGPT Developer Mode connection yet —
// treat this as a first draft to deploy and test, not a proven-working
// integration. If ChatGPT's client expects transport-level behavior
// this hand-rolled version doesn't implement (e.g. specific SSE framing
// for streaming responses), this will need a follow-up fix once you see
// the real connection attempt fail or succeed.
//
// Also depends on netlify/functions/personas.js (new file, same commit)
// for the Oracle's system prompt — see that file's own caveat: it is a
// NEW third copy of the prompt text until sanctum.html and
// qa-fact-check.js are migrated to import from it too.

const { getPersona } = require('./personas');

const SITE_URL = 'https://theinnersanctum.xyz';
const MODEL = 'claude-sonnet-5'; // ASSUMPTION: matches what sanctum.html's client sends today.
                                  // Verify against chat.js's actual server-side model config
                                  // once that file is available — chat.js may override this.
const MAX_TOKENS = 300;

const TOOL_DEFINITION = {
  name: 'ask_the_oracle',
  description:
    "Ask The Oracle — The Inner Sanctum's mystical fantasy football advisor with 38 seasons of wisdom — a fantasy football question. Good for start/sit calls, waiver pickups, trade advice, and general strategy. Returns a short, in-character answer plus a link to try the full tool.",
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set in this Netlify site\'s environment variables.');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
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
    throw new Error(`Anthropic API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data && data.content && data.content[0] && data.content[0].text;
  if (!text) {
    throw new Error('Anthropic API returned no text content.');
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

    // Unrecognized method — respond per JSON-RPC spec rather than crashing.
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
