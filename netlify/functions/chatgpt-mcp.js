// netlify/functions/chatgpt-mcp.js
//
// Inner Sanctum — ChatGPT MCP Bridge
// Phase 1: connection proof-of-concept
//
// PURPOSE:
// Prove that ChatGPT can discover and call an Inner Sanctum
// read-only MCP tool through the existing Netlify deployment.
//
// This version intentionally does NOT:
// - call SAGE
// - access league data
// - require authentication
// - modify any data
// - expose proprietary Inner Sanctum logic

const PROTOCOL_VERSION = "2026-07-28";

const SERVER_INFO = {
  name: "inner-sanctum",
  title: "Inner Sanctum Fantasy Football Intelligence",
  version: "0.1.0"
};

const TOOLS = [
  {
    name: "get_player_profile",
    title: "Get Inner Sanctum Player Profile",
    description:
      "Returns a basic read-only Inner Sanctum fantasy football player profile. " +
      "This is the initial connection test for the Inner Sanctum ChatGPT app.",
    inputSchema: {
      type: "object",
      properties: {
        player: {
          type: "string",
          description: "NFL player name, for example Ja'Marr Chase."
        }
      },
      required: ["player"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }
];

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Cache-Control": "no-store",
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function rpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function rpcError(id, code, message, data) {
  const error = {
    code,
    message
  };

  if (data !== undefined) {
    error.data = data;
  }

  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error
  };
}

function getPlayerProfile(player) {
  const normalized = String(player || "").trim();

  if (!normalized) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "A player name is required."
        }
      ]
    };
  }

  // ---------------------------------------------------------
  // PHASE 1 TEST RESPONSE
  //
  // This is intentionally static.
  // Once ChatGPT successfully calls this tool, this function
  // will be replaced with real Inner Sanctum player/SAGE data.
  // ---------------------------------------------------------

  return {
    content: [
      {
        type: "text",
        text:
          `Inner Sanctum connection successful.\n\n` +
          `Player requested: ${normalized}\n\n` +
          `This response came from the Inner Sanctum MCP server. ` +
          `Real Player Profile and SAGE data will be connected in the next phase.`
      }
    ],
    structuredContent: {
      connection: "success",
      source: "Inner Sanctum",
      player: normalized,
      phase: "MCP connection test",
      liveFantasyDataConnected: false
    }
  };
}

async function handleModernRequest(request) {
  const id = request.id ?? null;
  const method = request.method;
  const params = request.params || {};

  switch (method) {
    case "server/discover":
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: {
          tools: {}
        }
      });

    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS
      });

    case "tools/call": {
      const toolName = params.name;
      const args = params.arguments || {};

      if (!toolName) {
        return rpcError(
          id,
          -32602,
          "Invalid params: tool name is required."
        );
      }

      if (toolName !== "get_player_profile") {
        return rpcError(
          id,
          -32602,
          `Unknown tool: ${toolName}`
        );
      }

      return rpcResult(
        id,
        getPlayerProfile(args.player)
      );
    }

    default:
      return rpcError(
        id,
        -32601,
        `Method not found: ${method}`
      );
  }
}

async function handleLegacyRequest(request) {
  const id = request.id ?? null;
  const method = request.method;
  const params = request.params || {};

  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion:
          params.protocolVersion || "2025-11-25",
        capabilities: {
          tools: {}
        },
        serverInfo: SERVER_INFO
      });

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, {
        tools: TOOLS
      });

    case "tools/call": {
      const toolName = params.name;
      const args = params.arguments || {};

      if (toolName !== "get_player_profile") {
        return rpcError(
          id,
          -32602,
          `Unknown tool: ${toolName}`
        );
      }

      return rpcResult(
        id,
        getPlayerProfile(args.player)
      );
    }

    default:
      return rpcError(
        id,
        -32601,
        `Method not found: ${method}`
      );
  }
}

exports.handler = async function handler(event) {
  try {
    const httpMethod = event.httpMethod || "GET";

    // -------------------------------------------------------
    // CORS preflight
    // -------------------------------------------------------

    if (httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Cache-Control": "no-store"
        },
        body: ""
      };
    }

    // -------------------------------------------------------
    // Simple browser health check
    // -------------------------------------------------------

    if (httpMethod === "GET") {
      return jsonResponse(200, {
        status: "ok",
        service: "Inner Sanctum ChatGPT MCP",
        server: SERVER_INFO,
        protocolVersion: PROTOCOL_VERSION,
        message:
          "Inner Sanctum MCP endpoint is online. MCP requests should be sent using POST.",
        tools: TOOLS.map((tool) => tool.name)
      });
    }

    if (httpMethod !== "POST") {
      return jsonResponse(
        405,
        {
          error: "Method not allowed"
        },
        {
          Allow: "GET, POST, OPTIONS"
        }
      );
    }

    // -------------------------------------------------------
    // Parse JSON-RPC request
    // -------------------------------------------------------

    let request;

    try {
      request = JSON.parse(event.body || "{}");
    } catch (error) {
      return jsonResponse(
        400,
        rpcError(
          null,
          -32700,
          "Parse error: request body must be valid JSON."
        )
      );
    }

    if (
      !request ||
      request.jsonrpc !== "2.0" ||
      typeof request.method !== "string"
    ) {
      return jsonResponse(
        400,
        rpcError(
          request?.id ?? null,
          -32600,
          "Invalid JSON-RPC request."
        )
      );
    }

    // -------------------------------------------------------
    // Notifications have no response body.
    //
    // Legacy clients may send notifications/initialized.
    // We acknowledge those with HTTP 202.
    // -------------------------------------------------------

    if (request.id === undefined || request.id === null) {
      return {
        statusCode: 202,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Cache-Control": "no-store"
        },
        body: ""
      };
    }

    // -------------------------------------------------------
    // Determine protocol generation.
    //
    // Modern 2026 clients send MCP-Protocol-Version.
    // Older MCP clients may still begin with initialize.
    //
    // Supporting both makes our first connection test more
    // tolerant while ChatGPT's MCP implementation evolves.
    // -------------------------------------------------------

    const headers = event.headers || {};

    const requestedProtocol =
      headers["mcp-protocol-version"] ||
      headers["MCP-Protocol-Version"] ||
      "";

    const isModern =
      requestedProtocol === PROTOCOL_VERSION ||
      request.method === "server/discover";

    const response = isModern
      ? await handleModernRequest(request)
      : await handleLegacyRequest(request);

    return jsonResponse(200, response);
  } catch (error) {
    console.error("Inner Sanctum MCP error:", error);

    return jsonResponse(
      500,
      rpcError(
        null,
        -32603,
        "Internal Inner Sanctum MCP server error."
      )
    );
  }
};
