/* THE INNER SANCTUM — additive read-only CBS free-agent capture. */
(function () {
  "use strict";
  const PATH = "/stats/stats-main";
  const SPECIALIST_PATHS = [
    "/stats/stats-main/fa:K/week1:p/standard/projections",
    "/stats/stats-main/fa:DST/week1:p/standard/projections"
  ];
  const PLAYER_LINK = 'a[href*="/players/playerpage/"]';
  const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

  function playerId(href) {
    const m = String(href || "").match(/\/players\/playerpage\/(\d+)(?:[/?#]|$)/i);
    return m ? m[1] : null;
  }

  function positionTeam(text) {
    // Require an actual separator between position and NFL team. The former
    // optional separator allowed names beginning with position letters (for
    // example KIRK -> K + IR) to be misread as player identity.
    const m = clean(text).toUpperCase().match(/\b(QB|RB|WR|TE|PK|K|DST|DEF)(?:\s*[-•·]\s*|\s+)([A-Z]{2,3})\b/);
    if (!m) return null;
    const position = m[1] === "DEF" ? "DST" : (m[1] === "PK" ? "K" : m[1]);
    return { position, nflTeam: m[2] };
  }

  function percent(text) {
    const m = clean(text).match(/(\d+(?:\.\d+)?)\s*%/);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  }

  function parse(doc) {
    if (!/\bFREE AGENTS\b/i.test(clean(doc?.body?.textContent))) return [];
    const out = [];
    const seen = new Set();

    doc.querySelectorAll("tr").forEach((row) => {
      const link = row.querySelector(PLAYER_LINK);
      if (!link) return;
      const id = playerId(link.href || link.getAttribute?.("href"));

      // Position/team identity must come from the player's own table cell, not
      // the entire row. CBS rows contain unrelated stat/trend text that can
      // resemble a position/team token and previously misclassified players
      // such as Kirk Cousins as a kicker.
      const playerCell = typeof link.closest === "function" ? link.closest("td") : null;
      const identityText = playerCell?.textContent || link.textContent;
      const pt = positionTeam(identityText);
      let name = clean(link.textContent).replace(/\s+(QB|RB|WR|TE|PK|K|DST|DEF)(?:\s*[-•·]\s*|\s+)[A-Z]{2,3}\s*$/i, "");
      if (!id || !name || !pt || seen.has(id)) return;
      seen.add(id);

      let percentOwned = null;
      for (const cell of Array.from(row.querySelectorAll("td"))) {
        const n = percent(cell.textContent);
        if (n !== null) { percentOwned = n; break; }
      }

      out.push({
        id, cbsPlayerId: id, name,
        position: pt.position,
        team: pt.nflTeam,
        nflTeam: pt.nflTeam,
        availabilityStatus: "FREE_AGENT",
        percentOwned,
        source: "cbs-free-agents"
      });
    });
    return out;
  }

  function mergePlayers(groups) {
    const merged = [];
    const seen = new Set();
    for (const group of groups) {
      for (const player of group || []) {
        const id = clean(player?.cbsPlayerId || player?.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        merged.push(player);
      }
    }
    return merged;
  }

  async function fetchDocument(path) {
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin) throw new Error("Cross-origin CBS request refused.");
    const res = await fetch(url.href, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "text/html" } });
    if (!res.ok) throw new Error("CBS returned " + res.status + " for " + path + ".");
    return new DOMParser().parseFromString(await res.text(), "text/html");
  }

  async function fetchPlayers() {
    const basePlayers = parse(await fetchDocument(PATH));
    const groups = [basePlayers];

    // CBS's live Player Stats markup exposes free-agent K and DST pools through
    // these path-based routes. Keep specialist acquisition additive: if CBS
    // temporarily rejects one specialist request, preserve the known-good base
    // offensive pool rather than failing the entire capture.
    for (const path of SPECIALIST_PATHS) {
      try {
        groups.push(parse(await fetchDocument(path)));
      } catch (_) {
        groups.push([]);
      }
    }

    return mergePlayers(groups);
  }

  function install() {
    const c = window.CBSBrowserConnector;
    if (!c || typeof c.captureAll !== "function" || c.__freeAgentCaptureInstalled) return Boolean(c?.__freeAgentCaptureInstalled);
    const original = c.captureAll.bind(c);
    c.captureAll = async function () {
      const captured = await original();
      try {
        const players = await fetchPlayers();
        captured.availablePlayers = players;
        captured.league = captured.league || {};
        captured.league.availablePlayers = players;
        captured.meta = captured.meta || {};
        captured.meta.pagesRequested = captured.meta.pagesRequested || {};
        captured.meta.pagesRequested.freeAgents = PATH;
        captured.meta.pagesRequested.freeAgentSpecialists = SPECIALIST_PATHS.slice();
        captured.meta.dataQuality = captured.meta.dataQuality || {};
        captured.meta.dataQuality.availablePlayerCount = players.length;
      } catch (err) {
        captured.availablePlayers = [];
        captured.league = captured.league || {};
        captured.league.availablePlayers = [];
        captured.meta = captured.meta || {};
        captured.meta.warnings = Array.isArray(captured.meta.warnings) ? captured.meta.warnings : [];
        captured.meta.warnings.push("Could not collect CBS free agents: " + clean(err?.message || err));
      }
      return captured;
    };
    c.__freeAgentCaptureInstalled = true;
    return true;
  }

  window.CBSFreeAgentCapture = {
    path: PATH,
    specialistPaths: SPECIALIST_PATHS.slice(),
    parse,
    positionTeam,
    mergePlayers,
    fetchPlayers,
    install
  };
  install();
})();
