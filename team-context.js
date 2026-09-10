/*
  THE INNER SANCTUM — team-context.js
  --------------------------------------
  Shared customer-facing league/team context.

  ESPN team identity is resolved automatically. There is no separate
  customer-facing "select your team" step. Resolution uses safe persisted
  identity hints first, then a high-confidence roster fingerprint fallback.
*/
(function () {
  "use strict";

  if (typeof window.LeagueConnection === "undefined") return;

  const MANUAL_WEEKLY_KEY = "sanctum_weekly_manual_roster_v1";
  const ESPN_TEAM_PREF_KEY = "innerSanctum_espnTeamPreference_v1";
  const CHATGPT_LINK_STORAGE_KEY = "innerSanctum_chatgptLeagueLinks";

  // ESPN uses one ID system for a player's primary/default position and a
  // different ID system for lineup slots. Do not reuse lineup-slot IDs here.
  // defaultPositionId: QB=1, RB=2, WR=3, TE=4, K=5, D/ST=16.
  const ESPN_POSITION_BY_ID = { 1:"QB", 2:"RB", 3:"WR", 4:"TE", 5:"K", 16:"D/ST" };
  const ESPN_TEAM_BY_ID = {
    0:null,1:"ATL",2:"BUF",3:"CHI",4:"CIN",5:"CLE",6:"DAL",7:"DEN",8:"DET",9:"GB",
    10:"TEN",11:"IND",12:"KC",13:"LV",14:"LAR",15:"MIA",16:"MIN",17:"NE",18:"NO",
    19:"NYG",20:"NYJ",21:"PHI",22:"ARI",23:"PIT",24:"LAC",25:"SF",26:"SEA",27:"TB",
    28:"WSH",29:"CAR",30:"JAX",33:"BAL",34:"HOU"
  };

  function esc(value) {
    return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function providerLabel(connection) {
    const provider = connection?.provider;
    return LeagueConnection.PROVIDERS?.[provider]?.label || provider || "League";
  }

  function leagueName(connection) {
    return connection?.leagueName || connection?.league?.name || connection?.league?.settings?.name || "League";
  }

  function teamName(connection) {
    return connection?.teamName || connection?.team?.name || "Team not resolved";
  }

  function leagueId(connection) {
    return String(connection?.leagueId || connection?.league?.id || "").trim();
  }

  function scoringLabel(value) {
    const v = String(value || "").toLowerCase();
    if (v === "half-ppr" || v === "half_ppr" || v === "half") return "Half PPR";
    if (v === "ppr") return "PPR";
    if (v === "standard") return "Standard";
    return value || "";
  }

  function forceWeeklyConnectedSource() {
    try {
      const raw = localStorage.getItem(MANUAL_WEEKLY_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || parsed.source !== "manual") return false;
      parsed.source = "connected";
      localStorage.setItem(MANUAL_WEEKLY_KEY, JSON.stringify(parsed));
      return true;
    } catch (e) { return false; }
  }

  function teamDisplayName(team) {
    if (!team) return "Unnamed Team";
    if (team.name) return String(team.name).trim();
    const location = String(team.location || "").trim();
    const nickname = String(team.nickname || "").trim();
    const joined = [location,nickname].filter(Boolean).join(" ").trim();
    if (joined) return joined;
    if (team.abbrev) return String(team.abbrev).trim();
    return "Team " + String(team.id ?? "");
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeName(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  }

  function findEspnProjection(player, scoringPeriodId) {
    const stats = Array.isArray(player?.stats) ? player.stats : [];
    const projection = stats.find(function (stat) {
      return Number(stat?.scoringPeriodId) === Number(scoringPeriodId) &&
        Number(stat?.statSourceId) === 1 && numberOrNull(stat?.appliedTotal) !== null;
    });
    return projection ? numberOrNull(projection.appliedTotal) : 0;
  }

  function normalizeEspnRoster(team, league) {
    const entries = Array.isArray(team?.roster?.entries) ? team.roster.entries : [];
    const scoringPeriodId = Number(league?.scoringPeriodId || league?.status?.currentScoringPeriod || 1) || 1;
    return entries.map(function (entry) {
      const playerPoolEntry = entry?.playerPoolEntry || {};
      const player = playerPoolEntry?.player || entry?.player || {};
      const defaultPositionId = numberOrNull(player?.defaultPositionId);
      const proTeamId = numberOrNull(player?.proTeamId);
      const nflTeam = proTeamId !== null ? (ESPN_TEAM_BY_ID[proTeamId] || "") : "";
      const providerDisplayName = String(player?.fullName || player?.name || "").trim();
      const isDefense = defaultPositionId === 16;
      const canonicalName = isDefense && nflTeam ? nflTeam : providerDisplayName;
      return {
        providerPlayerId: player?.id != null ? String(player.id) : null,
        name: canonicalName,
        displayName: providerDisplayName || canonicalName,
        position: defaultPositionId !== null ? (ESPN_POSITION_BY_ID[defaultPositionId] || "") : "",
        team: nflTeam,
        nflTeam: nflTeam,
        projectedPoints: findEspnProjection(player, scoringPeriodId),
        lineupSlotId: entry?.lineupSlotId ?? null,
        status: playerPoolEntry?.status || null
      };
    }).filter(function (player) { return Boolean(player.name); });
  }

  function detectEspnScoringFormat(league) {
    const items = Array.isArray(league?.settings?.scoringSettings?.scoringItems)
      ? league.settings.scoringSettings.scoringItems : [];
    const reception = items.find(function (item) { return Number(item?.statId) === 53; });
    const points = numberOrNull(reception?.points);
    if (points === 1) return "ppr";
    if (points === 0.5) return "half-ppr";
    if (points === 0) return "standard";
    return null;
  }

  function normalizeEspnLineup(league) {
    const counts = league?.settings?.rosterSettings?.lineupSlotCounts || {};
    const get = function (id) { return Number(counts[id] ?? counts[String(id)] ?? 0) || 0; };
    return { QB:get(0), RB:get(2), WR:get(4), TE:get(6), FLEX:get(23), SUPERFLEX:get(7), K:get(17), DEF:get(16), BENCH:get(20), IR:get(21) };
  }

  function buildEspnTeamContextPatch(connection, team) {
    const league = connection?.league || {};
    const name = teamDisplayName(team);
    const normalizedTeam = {
      id: team?.id != null ? String(team.id) : null,
      name:name,
      location:team?.location || null,
      nickname:team?.nickname || null,
      abbrev:team?.abbrev || null,
      playoffSeed:team?.playoffSeed ?? null,
      record:team?.record || null
    };
    return {
      teamId: normalizedTeam.id,
      teamName: name,
      team: normalizedTeam,
      roster: normalizeEspnRoster(team, league),
      scoringFormat: detectEspnScoringFormat(league) || connection?.scoringFormat || null,
      lineupConstruction: normalizeEspnLineup(league),
      teamCount: Array.isArray(league?.teams) ? league.teams.length : connection?.teamCount,
      syncedAt: connection?.syncedAt || new Date().toISOString()
    };
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) { return null; }
  }

  function readEspnPreferences() {
    return readJson(ESPN_TEAM_PREF_KEY) || {};
  }

  function saveEspnPreference(connection) {
    const lid = leagueId(connection);
    const tid = String(connection?.teamId || connection?.team?.id || "").trim();
    if (!lid || !tid) return;
    try {
      const prefs = readEspnPreferences();
      prefs[lid] = { teamId:tid, teamName:teamName(connection) };
      localStorage.setItem(ESPN_TEAM_PREF_KEY, JSON.stringify(prefs));
    } catch (e) {}
  }

  function preferredEspnTeamId(connection) {
    const lid = leagueId(connection);
    if (!lid) return null;

    const serverResolvedId = String(connection?.league?.resolvedTeamId || "").trim();
    if (serverResolvedId) return serverResolvedId;

    const pref = readEspnPreferences()[lid];
    if (pref?.teamId) return String(pref.teamId);

    const links = readJson(CHATGPT_LINK_STORAGE_KEY);
    const espnLink = links?.espn;
    if (espnLink && String(espnLink.leagueId || "") === lid && espnLink.teamId) {
      return String(espnLink.teamId);
    }

    return null;
  }

  function manualRosterNames() {
    const stored = readJson(MANUAL_WEEKLY_KEY);
    const players = Array.isArray(stored?.players) ? stored.players : [];
    return new Set(players.map(function (player) {
      return normalizeName(player?.name || player?.displayName || "");
    }).filter(Boolean));
  }

  function inferEspnTeamFromRoster(connection) {
    const teams = Array.isArray(connection?.league?.teams) ? connection.league.teams : [];
    const known = manualRosterNames();
    if (known.size < 3 || !teams.length) return null;

    const scored = teams.map(function (team) {
      const roster = normalizeEspnRoster(team, connection.league);
      const names = new Set();
      roster.forEach(function (player) {
        names.add(normalizeName(player.displayName || player.name));
        names.add(normalizeName(player.name));
      });
      let matches = 0;
      known.forEach(function (name) { if (names.has(name)) matches += 1; });
      return { team:team, matches:matches };
    }).sort(function (a,b) { return b.matches - a.matches; });

    const best = scored[0];
    const second = scored[1];
    if (!best || best.matches < 3) return null;
    if (second && best.matches <= second.matches) return null;
    return best.team;
  }

  function findAutomaticEspnTeam(connection) {
    if (!connection || connection.provider !== "espn") return null;
    const teams = Array.isArray(connection?.league?.teams) ? connection.league.teams : [];
    if (!teams.length) return null;

    const preferredId = preferredEspnTeamId(connection);
    if (preferredId) {
      const preferred = teams.find(function (team) {
        return String(team?.id ?? "") === preferredId;
      });
      if (preferred) return preferred;
    }

    return inferEspnTeamFromRoster(connection);
  }

  function sameJson(a, b) {
    try { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }
    catch (e) { return false; }
  }

  function resolveActiveEspnTeamAutomatically() {
    const connection = LeagueConnection.getActiveConnection();
    if (!connection || connection.provider !== "espn") return false;
    if (!Array.isArray(connection?.league?.teams) || !connection.league.teams.length) return false;

    if (!connection.teamId) {
      const inferred = findAutomaticEspnTeam(connection);
      if (!inferred) return false;
      const updated = LeagueConnection.updateConnection(
        connection.connectionId,
        buildEspnTeamContextPatch(connection, inferred)
      );
      saveEspnPreference(updated);
      forceWeeklyConnectedSource();
      return true;
    }

    const rawTeam = connection.league.teams.find(function (team) {
      return String(team?.id ?? "") === String(connection.teamId);
    });
    if (!rawTeam) return false;

    const patch = buildEspnTeamContextPatch(connection, rawTeam);
    const needsRepair =
      String(connection.teamName || "") !== String(patch.teamName || "") ||
      String(connection.scoringFormat || "") !== String(patch.scoringFormat || "") ||
      Number(connection.teamCount || 0) !== Number(patch.teamCount || 0) ||
      !sameJson(connection.team, patch.team) ||
      !sameJson(connection.roster, patch.roster) ||
      !sameJson(connection.lineupConstruction, patch.lineupConstruction);

    if (needsRepair) {
      const updated = LeagueConnection.updateConnection(connection.connectionId, patch);
      saveEspnPreference(updated);
      forceWeeklyConnectedSource();
      return true;
    }

    saveEspnPreference(connection);
    return false;
  }

  function ensureStyles() {
    if (document.getElementById("innerSanctumTeamContextStyles")) return;
    const style = document.createElement("style");
    style.id = "innerSanctumTeamContextStyles";
    style.textContent = `
      .is-team-context-bar{background:#15100a;border-bottom:1px solid rgba(201,168,76,.28);padding:8px 18px;display:flex;justify-content:center;position:relative;z-index:120}
      .is-team-context-inner{width:min(1040px,100%);display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:#d9c79a;font-size:12px}
      .is-team-context-label{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:1.4px;text-transform:uppercase;color:#8a7a55}
      .is-team-context-select{background:#21180d;border:1px solid rgba(201,168,76,.35);color:#f2f1ef;border-radius:6px;padding:7px 30px 7px 10px;font:12px 'Lora',Georgia,serif;max-width:min(520px,100%)}
      .is-team-context-meta{color:#8f7f5d;font-size:11px}.is-team-context-chip{font-family:'Cinzel',serif;color:#f2f1ef;font-size:12px}
      @media(max-width:600px){.is-team-context-bar{padding:8px 12px}.is-team-context-select{width:100%;max-width:100%}}
    `;
    document.head.appendChild(style);
  }

  function connectionOptionLabel(connection) {
    const provider = providerLabel(connection), team = teamName(connection), league = leagueName(connection);
    if (connection.teamId) return team + " · " + provider + " · " + league;
    return league + " · " + provider + " · Team identity resolving";
  }

  function renderContextBar() {
    ensureStyles();
    const existing = document.getElementById("innerSanctumTeamContextBar");
    if (existing) existing.remove();
    const connections = LeagueConnection.getAllConnections();
    const active = LeagueConnection.getActiveConnection();
    if (!connections.length || !active) return;
    const bar = document.createElement("div");
    bar.className = "is-team-context-bar";
    bar.id = "innerSanctumTeamContextBar";
    const meta = [scoringLabel(active.scoringFormat), active.teamCount ? active.teamCount + " teams" : ""].filter(Boolean).join(" · ");
    if (connections.length === 1) {
      bar.innerHTML = '<div class="is-team-context-inner"><span class="is-team-context-label">Team</span><span class="is-team-context-chip">' +
        esc(connectionOptionLabel(active)) + '</span>' + (meta ? '<span class="is-team-context-meta">' + esc(meta) + '</span>' : '') + '</div>';
    } else {
      const options = connections.map(function (connection) {
        return '<option value="' + esc(connection.connectionId) + '"' + (connection.connectionId === active.connectionId ? ' selected' : '') + '>' +
          esc(connectionOptionLabel(connection)) + '</option>';
      }).join("");
      bar.innerHTML = '<div class="is-team-context-inner"><label class="is-team-context-label" for="innerSanctumTeamContextSelect">Team</label>' +
        '<select class="is-team-context-select" id="innerSanctumTeamContextSelect">' + options + '</select>' +
        (meta ? '<span class="is-team-context-meta">' + esc(meta) + '</span>' : '') + '</div>';
    }
    const header = document.querySelector(".hdr") || document.querySelector("header");
    if (header?.parentNode) header.parentNode.insertBefore(bar, header.nextSibling); else document.body.insertBefore(bar, document.body.firstChild);
    const select = document.getElementById("innerSanctumTeamContextSelect");
    if (select) select.addEventListener("change", function () {
      LeagueConnection.setActiveConnection(select.value);
      const selected = LeagueConnection.getActiveConnection();
      if (Array.isArray(selected?.roster) && selected.roster.length) forceWeeklyConnectedSource();
      window.location.reload();
    });
  }

  function repairWeeklySourceOnLoad() {
    const active = LeagueConnection.getActiveConnection();
    if (!active || !Array.isArray(active.roster) || !active.roster.length) return;
    if (!/\/weekly(?:\.html)?(?:$|[?#])/i.test(window.location.pathname + window.location.search)) return;
    if (forceWeeklyConnectedSource()) {
      const key = "innerSanctum_weeklyConnectedSourceRepair";
      if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key,"1"); window.location.reload(); }
    } else sessionStorage.removeItem("innerSanctum_weeklyConnectedSourceRepair");
  }

  function refresh() {
    resolveActiveEspnTeamAutomatically();
    renderContextBar();
  }

  function init() {
    refresh();
    repairWeeklySourceOnLoad();
  }

  window.addEventListener("innerSanctum:leagueContextChanged", function () {
    setTimeout(function () {
      refresh();
      repairWeeklySourceOnLoad();
    }, 0);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once:true }); else init();
})();