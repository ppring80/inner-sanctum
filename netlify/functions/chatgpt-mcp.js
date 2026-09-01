// netlify/functions/chatgpt-mcp.js
//
// Inner Sanctum — ChatGPT MCP Bridge
// Phase 1: connection proof-of-concept
//
// Uses the official Model Context Protocol TypeScript/JavaScript SDK.
//
// PURPOSE:
// Prove that ChatGPT can discover and call one read-only
// Inner Sanctum MCP tool.
//
// This version intentionally does NOT:
// - call SAGE
// - access league data
// - require authentication
// - modify any data
// - expose proprietary Inner Sanctum logic

const {
  createMcpHandler,
  McpServer
} = require("@modelcontextprotocol/server");

const { z } = require("zod");

const SERVER_INFO = {
  name: "inner-sanctum",
  version: "0.1.0"
};

function buildServer() {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    "get_player_profile",
    {
      title: "Get Inner Sanctum Player Profile",

      description:
        "Returns a basic read-only Inner Sanctum fantasy football player profile. " +
        "This is the initial connection test for the Inner Sanctum ChatGPT app.",

      inputSchema: z.object({
        player: z
          .string()
          .min(1)
          .describe("NFL player name, for example Ja'Marr Chase.")
      }),

      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },

    async ({ player }) => {
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

      // -----------------------------------------------------
      // PHASE 1 TEST RESPONSE
      //
      // This is intentionally static.
      //
      // Once ChatGPT successfully calls this tool, this
      // handler will be replaced with real Inner Sanctum
      // Player Profile / SAGE data.
      // -----------------------------------------------------

      const structuredContent = {
        connection: "success",
        source: "Inner Sanctum",
        player: normalized,
        phase: "MCP connection test",
        liveFantasyDataConnected: false
      };

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

        structuredContent
      };
    }
  );

  return server;
}

// -----------------------------------------------------------
// Official MCP HTTP handler
//
// createMcpHandler serves the modern 2026-07-28 MCP protocol
// and, by default, also supports legacy stateless 2025-era
// MCP requests.
// -----------------------------------------------------------

const mcpHandler = createMcpHandler(buildServer);

// -----------------------------------------------------------
// Netlify Function adapter
//
// Netlify provides an event-style function API.
// The MCP SDK expects a Web-standard Request/Response.
// This adapter converts between them.
// -----------------------------------------------------------

exports.handler = async function handler(event) {
  try {
    const headers = new Headers();

    for (const [key, value] of Object.entries(event.headers || {})) {
      if (value !== undefined && value !== null) {
        headers.set(key, String(value));
      }
    }

    const protocol =
      headers.get("x-forwarded-proto") ||
      headers.get("X-Forwarded-Proto") ||
      "https";

    const host =
      headers.get("x-forwarded-host") ||
      headers.get("X-Forwarded-Host") ||
      headers.get("host") ||
      "theinnersanctum.xyz";

    const rawPath =
      event.rawUrl ||
      `${protocol}://${host}${event.path || "/.netlify/functions/chatgpt-mcp"}`;

    const requestInit = {
      method: event.httpMethod || "GET",
      headers
    };

    if (
      event.body &&
      event.httpMethod !== "GET" &&
      event.httpMethod !== "HEAD"
    ) {
      requestInit.body = event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;
    }

    const request = new Request(rawPath, requestInit);

    const response = await mcpHandler.fetch(request);

    const responseHeaders = {};

    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    // Allow ChatGPT / browser-based MCP connection during POC.
    responseHeaders["access-control-allow-origin"] = "*";
    responseHeaders["access-control-allow-methods"] =
      "GET, POST, OPTIONS";
    responseHeaders["access-control-allow-headers"] =
      "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name";

    const body = await response.text();

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body
    };
  } catch (error) {
    console.error("Inner Sanctum MCP error:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({
        error: "Internal Inner Sanctum MCP server error."
      })
    };
  }
};
