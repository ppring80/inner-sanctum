/*
  THE INNER SANCTUM — team-context.js
  --------------------------------------
  Shared customer-facing league/team context.

  Goals:
  - keep league connection simple;
  - support multiple teams across multiple providers;
  - make one selected team the source of roster/scoring/settings context;
  - prevent a saved manual Weekly roster from silently overriding a valid
    connected roster after the customer changes teams;
  - resolve ESPN public-league team identity explicitly without a modal.
*/
(function () {
  "use strict";

  if (typeof window.LeagueConnection === "undefined") return;

  const MANUAL_WEEKLY_KEY = "sanctum_weekly_manual_roster_v1";
  const ESPN_POSITION_BY_ID = { 0:"QB", 2:"RB", 4:"WR", 6:"TE", 16:"D/ST", 17:"K" };
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
    return connection?.teamName || connection?.team?.name || "Team not selected";
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

      /*
        Weekly SAGE identifies DEF records by canonical NFL team code
        (HOU, SF, DAL, etc.). ESPN often returns a display name such as
        "Houston Texans" for the same roster slot. Canonicalize ONLY ESPN
        D/ST names to the NFL team code while preserving ESPN's display name.
        Every QB/RB/WR/TE/K name remains untouched.
      */
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

  function repairActiveEspnDefenseIdentity() {
    const connection = LeagueConnection.getActiveConnection();
    if (!connection || connection.provider !== "espn" || !connection.teamId) return false;
    if (!Array.isArray(connection?.league?.teams) || !connection.league.teams.length) return false;

    const rawTeam = connection.league.teams.find(function (team) {
      return String(team?.id ?? "") === String(connection.teamId);
    });
    if (!rawTeam) return false;

    const normalizedRoster = normalizeEspnRoster(rawTeam, connection.league);
    const currentRoster = Array.isArray(connection.roster) ? connection.roster : [];
    const normalizedDefense = normalizedRoster.find(function (player) { return player.position === "D/ST"; });
    const currentDefense = currentRoster.find(function (player) {
      return player?.position === "D/ST" || player?.position === "DEF" || player?.position === "DST";
    });

    if (!normalizedDefense) return false;
    if (currentDefense && currentDefense.name === normalizedDefense.name && currentRoster.length === normalizedRoster.length) return false;

    LeagueConnection.updateConnection(connection.connectionId, {
      roster: normalizedRoster,
      syncedAt: connection.syncedAt || new Date().toISOString()
    });
    return true;
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

  function resolveEspnTeam(connection, team) {
    const oldId = connection.connectionId;
    const league = connection.league || {};
    const name = teamDisplayName(team);
    const normalizedTeam = {
      id: team?.id != null ? String(team.id) : null,
      name:name, location:team?.location || null, nickname:team?.nickname || null,
      abbrev:team?.abbrev || null, playoffSeed:team?.playoffSeed ?? null, record:team?.record || null
    };
    const updated = LeagueConnection.updateConnection(oldId, {
      teamId:normalizedTeam.id,
      teamName:name,
      team:normalizedTeam,
      roster:normalizeEspnRoster(team, league),
      scoringFormat:connection.scoringFormat || detectEspnScoringFormat(league),
      lineupConstruction:normalizeEspnLineup(league),
      teamCount:Array.isArray(league?.teams) ? league.teams.length : connection.teamCount,
      syncedAt:new Date().toISOString()
    });
    forceWeeklyConnectedSource();
    return updated;
  }

  function needsEspnTeamSelection(connection) {
    return connection?.provider === "espn" && !connection?.teamId &&
      Array.isArray(connection?.league?.teams) && connection.league.teams.length > 0;
  }

  function isConnectLeaguePage() {
    return /\/connect-league(?:\.html)?(?:$|[?#])/i.test(window.location.pathname + window.location.search);
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
      .is-espn-team-step{margin-top:14px;padding:14px;border:1px solid rgba(201,168,76,.25);border-radius:8px;background:rgba(255,255,255,.025);text-align:left}
      .is-espn-team-step-title{font:600 13px 'Lora',Georgia,serif;color:#f2f1ef;margin-bottom:4px}
      .is-espn-team-step-copy{font:11px/1.5 'Lora',Georgia,serif;color:#8a7a55;margin-bottom:10px}
      .is-espn-team-step select{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(201,168,76,.25);color:#f2f1ef;font:13px 'Lora',Georgia,serif;padding:10px 12px;border-radius:6px;margin-bottom:9px}
      .is-espn-team-step button{width:100%;padding:12px 16px;background:linear-gradient(135deg,#c9a84c,#8b6914);color:#0a0600;font:600 13px 'Cinzel',serif;border:0;border-radius:8px;cursor:pointer;letter-spacing:.6px}
      .is-espn-team-step button:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:600px){.is-team-context-bar{padding:8px 12px}.is-team-context-select{width:100%;max-width:100%}}
    `;
    document.head.appendChild(style);
  }

  function connectionOptionLabel(connection) {
    const provider = providerLabel(connection), team = teamName(connection), league = leagueName(connection);
    if (connection.teamId) return team + " · " + provider + " · " + league;
    return league + " · " + provider + " · Team setup incomplete";
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

  function renderEspnTeamStep(connection) {
    const old = document.getElementById("innerSanctumEspnTeamStep");
    if (old) old.remove();
    if (!isConnectLeaguePage() || !needsEspnTeamSelection(connection)) return;
    const form = document.querySelector("#providerForms .provider-form.show");
    if (!form) return;
    ensureStyles();
    const teams = connection.league.teams.slice().sort(function (a,b) { return teamDisplayName(a).localeCompare(teamDisplayName(b)); });
    const step = document.createElement("div");
    step.className = "is-espn-team-step";
    step.id = "innerSanctumEspnTeamStep";
    step.innerHTML = '<div class="is-espn-team-step-title">' + esc(leagueName(connection)) + '</div>' +
      '<div class="is-espn-team-step-copy">One last step — select your team.</div>' +
      '<select id="innerSanctumEspnTeamSelect"><option value="">Select your team</option>' +
      teams.map(function (team,index) { return '<option value="' + index + '">' + esc(teamDisplayName(team)) + '</option>'; }).join("") +
      '</select><button type="button" id="innerSanctumEspnTeamConfirm" disabled>Finish ESPN Connection</button>';
    form.appendChild(step);
    const select = document.getElementById("innerSanctumEspnTeamSelect");
    const button = document.getElementById("innerSanctumEspnTeamConfirm");
    select.addEventListener("change", function () { button.disabled = select.value === ""; });
    button.addEventListener("click", function () {
      const team = teams[Number(select.value)];
      if (!team) return;
      button.disabled = true;
      button.textContent = "Connecting…";
      resolveEspnTeam(connection, team);
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
    renderContextBar();
    renderEspnTeamStep(LeagueConnection.getActiveConnection());
  }

  function init() {
    repairActiveEspnDefenseIdentity();
    refresh();
    repairWeeklySourceOnLoad();
  }

  window.addEventListener("innerSanctum:leagueContextChanged", function () {
    setTimeout(function () {
      repairActiveEspnDefenseIdentity();
      refresh();
    }, 0);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once:true }); else init();
})();