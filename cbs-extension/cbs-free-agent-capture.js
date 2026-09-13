/* THE INNER SANCTUM — additive read-only CBS free-agent capture. */
(function () {
  "use strict";
  const PATH = "/stats/stats-main";
  const PLAYER_LINK = 'a[href*="/players/playerpage/"]';
  const SPECIALIST_POSITIONS = new Set(["K", "PK", "DST", "DEF"]);
  const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  let lastDiagnostics = null;

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

      // Prefer identity from the player's own table cell. This is the safety
      // fix that keeps names such as Kirk Cousins from being misread by
      // unrelated row text. Some CBS specialist rows, however, place the
      // position/team token outside that link cell. If the player cell has no
      // usable identity at all, fall back to the row text while retaining the
      // strict separator requirement in positionTeam().
      const playerCell = typeof link.closest === "function" ? link.closest("td") : null;
      const identityText = playerCell?.textContent || link.textContent;
      const pt = positionTeam(identityText) || positionTeam(row.textContent);
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

  function specialistDiagnostics(doc, players) {
    const counts = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
    (Array.isArray(players) ? players : []).forEach((player) => {
      const pos = player?.position === "DEF" ? "DST" : (player?.position === "PK" ? "K" : player?.position);
      if (Object.prototype.hasOwnProperty.call(counts, pos)) counts[pos] += 1;
    });

    const discovered = [];
    const seen = new Set();
    function consider(label, value) {
      const normalized = clean(label).toUpperCase().replace(/\s+/g, "");
      if (!SPECIALIST_POSITIONS.has(normalized) || !value) return;
      let url;
      try { url = new URL(String(value), location.origin); } catch (err) { return; }
      if (url.origin !== location.origin || !url.pathname.startsWith(PATH)) return;
      const safeKey = normalized + "|" + url.pathname + url.search;
      if (seen.has(safeKey)) return;
      seen.add(safeKey);
      discovered.push({ label: normalized, path: url.pathname + url.search });
    }

    if (doc && typeof doc.querySelectorAll === "function") {
      Array.from(doc.querySelectorAll("a[href]")).forEach((link) => {
        consider(link.textContent, link.href || link.getAttribute?.("href"));
      });
      Array.from(doc.querySelectorAll("option[value]")).forEach((option) => {
        consider(option.textContent, option.value || option.getAttribute?.("value"));
      });
    }

    return {
      baseTotal: Array.isArray(players) ? players.length : 0,
      byPosition: counts,
      specialistLinks: discovered
    };
  }

  async function fetchPlayers() {
    const url = new URL(PATH, location.origin);
    if (url.origin !== location.origin) throw new Error("Cross-origin CBS request refused.");
    const res = await fetch(url.href, { method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "text/html" } });
    if (!res.ok) throw new Error("CBS returned " + res.status + " for free agents.");
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    const players = parse(doc);
    lastDiagnostics = specialistDiagnostics(doc, players);
    return players;
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
        captured.meta.dataQuality = captured.meta.dataQuality || {};
        captured.meta.dataQuality.availablePlayerCount = players.length;
        captured.meta.dataQuality.cbsFreeAgentDiagnostics = lastDiagnostics;
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

  window.CBSFreeAgentCapture = { path: PATH, parse, positionTeam, specialistDiagnostics, fetchPlayers, install };
  install();
})();
