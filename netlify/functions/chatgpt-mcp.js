// netlify/functions/chatgpt-mcp.js
//
// Inner Sanctum — ChatGPT MCP Bridge
// Phase 2: LIVE Inner Sanctum Player Profile
//
// PURPOSE:
// Allow ChatGPT to retrieve a real read-only Inner Sanctum
// fantasy-football player profile using the existing production
// Weekly SAGE rankings pipeline.
//
// DATA SOURCE:
// /.netlify/functions/weekly-sage-rankings
//
// IMPORTANT:
// This function does NOT:
// - recalculate SAGE
// - expose SAGE formulas or proprietary methodology
// - access league/private roster data
// - require authentication
// - modify any Inner Sanctum data
// - fabricate missing player information

const {
  createMcpHandler,
  McpServer
} = require("@modelcontextprotocol/server");

const { z } = require("zod");

const SERVER_INFO = {
  name: "inner-sanctum",
  version: "0.2.0"
};

const DEFAULT_SEASON = 2026;
const DEFAULT_SCORING = "ppr";
const DEFAULT_TEAMS = 12;
const DEFAULT_SEASON_TYPE = "reg";

const MATCHUP_EXPLANATION = {
  "Strong Positive": "Very favorable matchup for this position.",
  "Positive": "Favorable matchup for this position.",
  "Neutral": "Neither a clear advantage nor disadvantage.",
  "Negative": "Tough matchup for this position.",
  "Strong Negative": "Very tough matchup for this position."
};

// -----------------------------------------------------------
// Utility helpers
// -----------------------------------------------------------

function cleanString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const text = String(value).trim();

  return text ? text : null;
}

function num(value) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function normalizePlayerName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, " ");
}

function getCurrentNFLWeek() {
  const now = new Date();

  const seasonStart = new Date(
    Date.UTC(
      2026,
      8,
      9,
      0,
      0,
      0
    )
  );

  if (now < seasonStart) {
    return 1;
  }

  const millisecondsPerWeek =
    7 * 24 * 60 * 60 * 1000;

  const diff =
    now.getTime() -
    seasonStart.getTime();

  const week =
    Math.floor(
      diff / millisecondsPerWeek
    ) + 1;

  return Math.max(
    1,
    Math.min(18, week)
  );
}

function getRequestBaseUrl(request) {
  if (request && request.url) {
    try {
      return new URL(request.url).origin;
    } catch (error) {
      // Fall through to production origin.
    }
  }

  return "https://theinnersanctum.xyz";
}

function buildWeeklyRankingsUrl({
  baseUrl,
  season,
  week,
  scoring
}) {
  const params =
    new URLSearchParams({
      season:
        String(season),

      week:
        String(week),

      seasonType:
        DEFAULT_SEASON_TYPE,

      scoring:
        scoring,

      teams:
        String(DEFAULT_TEAMS)
    });

  return (
    `${baseUrl}/.netlify/functions/weekly-sage-rankings?` +
    params.toString()
  );
}

// -----------------------------------------------------------
// Production Weekly SAGE retrieval
// -----------------------------------------------------------

async function fetchWeeklyRankings({
  baseUrl,
  season,
  week,
  scoring
}) {
  const url =
    buildWeeklyRankingsUrl({
      baseUrl,
      season,
      week,
      scoring
    });

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          Accept:
            "application/json"
        }
      }
    );

  let data = null;

  try {
    data =
      await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const detail =
      data &&
      (
        data.error ||
        data.detail
      )
        ? (
            data.error ||
            data.detail
          )
        : `HTTP ${response.status}`;

    throw new Error(
      `Weekly SAGE request failed: ${detail}`
    );
  }

  if (
    !data ||
    !data.positions ||
    typeof data.positions !== "object"
  ) {
    throw new Error(
      "Weekly SAGE returned an unexpected response."
    );
  }

  return data;
}

// -----------------------------------------------------------
// Flatten existing Weekly SAGE response
//
// Mirrors the production Weekly Rankings page's mapping.
// No SAGE values are recalculated here.
// -----------------------------------------------------------

function flattenRankings(rankings) {
  if (
    !rankings ||
    !rankings.positions
  ) {
    return [];
  }

  const rows = [];

  [
    "QB",
    "RB",
    "WR",
    "TE",
    "K",
    "DEF"
  ].forEach((position) => {
    const list =
      rankings.positions[position];

    if (!Array.isArray(list)) {
      return;
    }

    list.forEach((entry) => {
      const sage =
        entry.sage &&
        typeof entry.sage === "object"
          ? entry.sage
          : {};

      rows.push({
        playerID:
          cleanString(
            entry.playerID
          ),

        name:
          cleanString(
            entry.name
          ) ||
          "(unknown player)",

        position:
          cleanString(
            entry.position
          ) ||
          position,

        team:
          cleanString(
            entry.team
          ),

        opponent:
          cleanString(
            entry.opponent
          ),

        recommendation:
          cleanString(
            entry.recommendation
          ),

        sageScore:
          num(
            sage.score !== undefined
              ? sage.score
              : entry.sageScore
          ),

        sageLabel:
          cleanString(
            sage.label !== undefined
              ? sage.label
              : entry.sageLabel
          ),

        sageConfidence:
          num(
            sage.confidence !== undefined
              ? sage.confidence
              : entry.sageConfidence
          ),

        sageConfidenceLabel:
          cleanString(
            sage.confidenceLabel !== undefined
              ? sage.confidenceLabel
              : entry.sageConfidenceLabel
          ),

        adp:
          num(
            entry.adp
          ),

        overallRank:
          num(
            entry.overallRank
          ),

        positionRank:
          num(
            entry.positionRank !== undefined
              ? entry.positionRank
              : entry.rank
          ),

        matchup:
          cleanString(
            entry.matchupStrength !== undefined
              ? entry.matchupStrength
              : entry.matchup
          ),

        matchupEvidence:
          entry.matchupEvidence ||
          null,

        components:
          entry.components ||
          null,

        sageTake:
          cleanString(
            entry.sageTake
          )
      });
    });
  });

  return rows;
}

// -----------------------------------------------------------
// Player lookup
// -----------------------------------------------------------

function findPlayer(
  rankings,
  requestedName
) {
  const rows =
    flattenRankings(rankings);

  const target =
    normalizePlayerName(
      requestedName
    );

  let player =
    rows.find(
      (row) =>
        normalizePlayerName(
          row.name
        ) === target
    );

  if (player) {
    return player;
  }

  const partialMatches =
    rows.filter((row) => {
      const candidate =
        normalizePlayerName(
          row.name
        );

      return (
        candidate.includes(target) ||
        target.includes(candidate)
      );
    });

  if (
    partialMatches.length === 1
  ) {
    return partialMatches[0];
  }

  return null;
}

// -----------------------------------------------------------
// Universal Player Profile V1 mapping
// -----------------------------------------------------------

function buildProfileModel(
  row,
  {
    season,
    week,
    scoring
  }
) {
  const rankStats = [];

  if (
    row.positionRank !== null
  ) {
    rankStats.push({
      label:
        `${row.position} Rank`,

      value:
        String(
          row.positionRank
        )
    });
  }

  if (
    row.overallRank !== null
  ) {
    rankStats.push({
      label:
        "Overall Rank",

      value:
        String(
          row.overallRank
        )
    });
  }

  if (
    row.adp !== null
  ) {
    rankStats.push({
      label:
        "ADP",

      value:
        row.adp.toFixed(1)
    });
  }

  const contextStats = [];

  if (row.opponent) {
    contextStats.push({
      label:
        "Opponent",

      value:
        row.opponent
    });
  }

  if (row.matchup) {
    contextStats.push({
      label:
        "Matchup",

      value:
        row.matchup
    });
  }

  const risks = [];

  if (
    row.matchup === "Negative" ||
    row.matchup === "Strong Negative"
  ) {
    const explanation =
      MATCHUP_EXPLANATION[
        row.matchup
      ];

    if (explanation) {
      risks.push(
        explanation
      );
    }
  }

  const hasVerdict =
    Boolean(
      row.sageLabel ||
      row.recommendation ||
      row.sageConfidenceLabel
    );

  return {
    identity: {
      id:
        row.playerID ||
        `${row.name}|${row.position}`,

      playerID:
        row.playerID ||
        null,

      name:
        row.name,

      position:
        row.position,

      team:
        row.team ||
        null,

      photoUrl:
        null
    },

    verdict:
      hasVerdict
        ? {
            label:
              row.sageLabel ||
              null,

            action:
              row.recommendation
                ? row.recommendation
                    .toUpperCase()
                : null,

            confidence:
              row.sageConfidenceLabel ||
              null,

            reasons:
              []
          }
        : null,

    rankProjection:
      rankStats.length
        ? {
            stats:
              rankStats
          }
        : null,

    contextPanel:
      contextStats.length
        ? {
            title:
              `This Week — Week ${week}`,

            stats:
              contextStats,

            note:
              null
          }
        : null,

    recentForm:
      null,

    risks:
      risks.length
        ? risks
        : null,

    outlookNote:
      null,

    insight:
      row.sageTake ||
      null,

    context: {
      season,
      week,
      scoring,

      teams:
        DEFAULT_TEAMS,

      source:
        "Inner Sanctum Weekly SAGE"
    }
  };
}

// -----------------------------------------------------------
// Human-readable response
// -----------------------------------------------------------

function profileToText(profile) {
  const lines = [];

  const identity =
    profile.identity;

  lines.push(
    `${identity.name} — ${identity.position}` +
    (
      identity.team
        ? `, ${identity.team}`
        : ""
    )
  );

  if (profile.verdict) {
    const verdictBits = [];

    if (
      profile.verdict.label
    ) {
      verdictBits.push(
        profile.verdict.label
      );
    }

    if (
      profile.verdict.action
    ) {
      verdictBits.push(
        profile.verdict.action
      );
    }

    if (
      profile.verdict.confidence
    ) {
      verdictBits.push(
        `${profile.verdict.confidence} confidence`
      );
    }

    if (verdictBits.length) {
      lines.push(
        `SAGE Verdict: ${verdictBits.join(" | ")}`
      );
    }
  }

  if (
    profile.rankProjection &&
    profile.rankProjection.stats.length
  ) {
    lines.push(
      "Rank & Value: " +
      profile.rankProjection.stats
        .map(
          (item) =>
            `${item.label} ${item.value}`
        )
        .join(" | ")
    );
  }

  if (
    profile.contextPanel &&
    profile.contextPanel.stats.length
  ) {
    lines.push(
      `${profile.contextPanel.title}: ` +
      profile.contextPanel.stats
        .map(
          (item) =>
            `${item.label} ${item.value}`
        )
        .join(" | ")
    );
  }

  if (
    Array.isArray(
      profile.risks
    ) &&
    profile.risks.length
  ) {
    lines.push(
      `Risk: ${profile.risks.join(" ")}`
    );
  }

  if (profile.insight) {
    lines.push(
      `Inner Sanctum Insight: ${profile.insight}`
    );
  }

  lines.push(
    `Source: ${profile.context.source}; ` +
    `${profile.context.season} Week ${profile.context.week}; ` +
    `${profile.context.scoring.toUpperCase()} scoring.`
  );

  return lines.join("\n\n");
}

// -----------------------------------------------------------
// MCP server factory
//
// The current MCP SDK passes the original HTTP Request to the
// factory as ctx.requestInfo. That lets this tool call the same
// deployed Inner Sanctum origin without creating another handler.
// -----------------------------------------------------------

function buildServer(request) {
  const server =
    new McpServer(
      SERVER_INFO
    );

  server.registerTool(
    "get_player_profile",

    {
      title:
        "Get Inner Sanctum Player Profile",

      description:
        "Returns a real read-only Inner Sanctum fantasy football player profile " +
        "using the production Weekly SAGE rankings pipeline. Use this when the " +
        "user asks what Inner Sanctum or SAGE thinks about an NFL fantasy player, " +
        "including weekly rank, recommendation, matchup, value, risks, or insight.",

      inputSchema:
        z.object({
          player:
            z
              .string()
              .min(1)
              .describe(
                "NFL player name, for example Ja'Marr Chase."
              ),

          season:
            z
              .number()
              .int()
              .min(2026)
              .max(2035)
              .optional()
              .describe(
                "NFL season. Defaults to 2026."
              ),

          week:
            z
              .number()
              .int()
              .min(1)
              .max(18)
              .optional()
              .describe(
                "NFL regular-season week. Defaults to the current Inner Sanctum week."
              ),

          scoring:
            z
              .enum([
                "ppr",
                "half",
                "standard"
              ])
              .optional()
              .describe(
                "Fantasy scoring format. Defaults to PPR."
              )
        }),

      annotations: {
        readOnlyHint:
          true,

        destructiveHint:
          false,

        idempotentHint:
          true,

        openWorldHint:
          false
      }
    },

    async ({
      player,
      season,
      week,
      scoring
    }) => {
      const requestedPlayer =
        cleanString(player);

      if (!requestedPlayer) {
        return {
          isError:
            true,

          content: [
            {
              type:
                "text",

              text:
                "A player name is required."
            }
          ]
        };
      }

      const resolvedSeason =
        season ||
        DEFAULT_SEASON;

      const resolvedWeek =
        week ||
        getCurrentNFLWeek();

      const resolvedScoring =
        scoring ||
        DEFAULT_SCORING;

      try {
        const baseUrl =
          getRequestBaseUrl(
            request
          );

        const rankings =
          await fetchWeeklyRankings({
            baseUrl,

            season:
              resolvedSeason,

            week:
              resolvedWeek,

            scoring:
              resolvedScoring
          });

        const row =
          findPlayer(
            rankings,
            requestedPlayer
          );

        if (!row) {
          return {
            isError:
              true,

            content: [
              {
                type:
                  "text",

                text:
                  `Inner Sanctum could not find "${requestedPlayer}" ` +
                  `in the ${resolvedSeason} Week ${resolvedWeek} ` +
                  `${resolvedScoring.toUpperCase()} Weekly SAGE rankings.`
              }
            ],

            structuredContent: {
              found:
                false,

              playerRequested:
                requestedPlayer,

              season:
                resolvedSeason,

              week:
                resolvedWeek,

              scoring:
                resolvedScoring,

              source:
                "Inner Sanctum Weekly SAGE"
            }
          };
        }

        const profile =
          buildProfileModel(
            row,
            {
              season:
                resolvedSeason,

              week:
                resolvedWeek,

              scoring:
                resolvedScoring
            }
          );

        return {
          content: [
            {
              type:
                "text",

              text:
                profileToText(
                  profile
                )
            }
          ],

          structuredContent: {
            found:
              true,

            source:
              "Inner Sanctum",

            liveFantasyDataConnected:
              true,

            profile
          }
        };
      } catch (error) {
        console.error(
          "Inner Sanctum player profile error:",
          error
        );

        return {
          isError:
            true,

          content: [
            {
              type:
                "text",

              text:
                "Inner Sanctum could not retrieve the live Player Profile right now."
            }
          ],

          structuredContent: {
            found:
              false,

            playerRequested:
              requestedPlayer,

            season:
              resolvedSeason,

            week:
              resolvedWeek,

            scoring:
              resolvedScoring,

            source:
              "Inner Sanctum",

            error:
              "live_profile_unavailable"
          }
        };
      }
    }
  );

  return server;
}

// -----------------------------------------------------------
// Official MCP Streamable HTTP handler
//
// createMcpHandler creates a fresh server from this factory for
// each HTTP request. The SDK passes the original request through
// ctx.requestInfo.
// -----------------------------------------------------------

const mcpHandler =
  createMcpHandler(
    (ctx) =>
      buildServer(
        ctx &&
        ctx.requestInfo
          ? ctx.requestInfo
          : null
      )
  );

// -----------------------------------------------------------
// Netlify Function adapter
// -----------------------------------------------------------

exports.handler =
  async function handler(event) {
    try {
      const headers =
        new Headers();

      for (
        const [key, value]
        of Object.entries(
          event.headers || {}
        )
      ) {
        if (
          value !== undefined &&
          value !== null
        ) {
          headers.set(
            key,
            String(value)
          );
        }
      }

      const protocol =
        headers.get(
          "x-forwarded-proto"
        ) ||
        "https";

      const host =
        headers.get(
          "x-forwarded-host"
        ) ||
        headers.get(
          "host"
        ) ||
        "theinnersanctum.xyz";

      const rawUrl =
        event.rawUrl ||
        (
          `${protocol}://${host}` +
          (
            event.path ||
            "/.netlify/functions/chatgpt-mcp"
          )
        );

      const requestInit = {
        method:
          event.httpMethod ||
          "GET",

        headers
      };

      if (
        event.body &&
        event.httpMethod !== "GET" &&
        event.httpMethod !== "HEAD"
      ) {
        requestInit.body =
          event.isBase64Encoded
            ? Buffer.from(
                event.body,
                "base64"
              )
            : event.body;
      }

      const request =
        new Request(
          rawUrl,
          requestInit
        );

      const response =
        await mcpHandler.fetch(
          request
        );

      const responseHeaders = {};

      response.headers.forEach(
        (value, key) => {
          responseHeaders[key] =
            value;
        }
      );

      responseHeaders[
        "access-control-allow-origin"
      ] = "*";

      responseHeaders[
        "access-control-allow-methods"
      ] =
        "GET, POST, OPTIONS";

      responseHeaders[
        "access-control-allow-headers"
      ] =
        "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name";

      const body =
        await response.text();

      return {
        statusCode:
          response.status,

        headers:
          responseHeaders,

        body
      };
    } catch (error) {
      console.error(
        "Inner Sanctum MCP error:",
        error
      );

      return {
        statusCode:
          500,

        headers: {
          "Content-Type":
            "application/json; charset=utf-8",

          "Access-Control-Allow-Origin":
            "*",

          "Cache-Control":
            "no-store"
        },

        body:
          JSON.stringify({
            error:
              "Internal Inner Sanctum MCP server error."
          })
      };
    }
  };
