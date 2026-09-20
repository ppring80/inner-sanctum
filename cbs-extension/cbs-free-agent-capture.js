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

  function numberOrNull(value) {
    const text = clean(value).replace(/,/g, "");
    if (!text || text.includes("%") || !/^-?\d+(?:\.\d+)?$/.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function projectionHeader(value) {
    const label = clean(value).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
    return label === "PTS" || label === "FPTS" || label === "PROJ" ||
      label === "PROJ PTS" || label === "PROJECTED" || label === "PROJECTED PTS";
  }

  function projectedPoints(row, cells) {
    // CBS commonly supplies responsive data-label attributes even when the
    // visible header is outside the row. Prefer those exact labels.
    for (const cell of cells) {
      const label = cell.getAttribute?.("data-label") || cell.getAttribute?.("aria-label");
      if (!projectionHeader(label)) continue;
      const points = numberOrNull(cell.textContent);
      if (points !== null) return points;
    }

    // Desktop CBS tables expose a conventional header row. Only read a value
    // from a specifically named projection column; never guess from arbitrary
    // numeric stats, ownership, or ranking columns.
    const table = row.closest?.("table");
    const headers = Array.from(table?.querySelectorAll?.("thead th") || []);
    const index = headers.findIndex((header) => projectionHeader(header.textContent));
    return index >= 0 ? numberOrNull(cells[index]?.textContent) : null;
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

      const cells = Array.from(row.querySelectorAll("td"));
      let percentOwned = null;
      for (const cell of cells) {
        const n = percent(cell.textContent);
        if (n !== null) { percentOwned = n; break; }
      }

      const projection = projectedPoints(row, cells);

      out.push({
        id, cbsPlayerId: id, name,
        position: pt.position,
        team: pt.nflTeam,
        nflTeam: pt.nflTeam,
        availabilityStatus: "FREE_AGENT",
        percentOwned,
        projectedPoints: projection,
        source: "cbs-free-agents"
      });
    });
    return out;
  }

  function addCapturedProjections(players, projections) {
    const byId = new Map();
    const byName = new Map();
    for (const projection of projections?.playerProjectionsById || []) {
      const id = clean(projection?.cbsPlayerId);
      if (id) byId.set(id, projection);
    }
    for (const projection of projections?.playerProjectionsByName || []) {
      const name = clean(projection?.name).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (name) byName.set(name, projection);
    }
    return (players || []).map((player) => {
      if (numberOrNull(player?.projectedPoints) !== null) return player;
      const id = clean(player?.cbsPlayerId || player?.id);
      const name = clean(player?.name).toLowerCase().replace(/[^a-z0-9]/g, "");
      const projection = byId.get(id) || byName.get(name);
      const points = numberOrNull(projection?.projectedPoints);
      return points === null ? player : { ...player, projectedPoints: points };
    });
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
        const players = addCapturedProjections(await fetchPlayers(), captured.projections);
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
    addCapturedProjections,
    fetchPlayers,
    install
  };
  install();
})();
