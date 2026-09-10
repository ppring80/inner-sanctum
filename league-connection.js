/*
  THE INNER SANCTUM — league-connection.js
  -------------------------------------------
  Shared fantasy-league connection state.

  V2: one customer may have many league/team connections, including
  multiple leagues on the same provider. One connection is active and
  becomes the context used by connected-league tools.

  SECURITY: only sanitized league/team metadata belongs in localStorage.
  Provider passwords, cookies, OAuth tokens, ESPN espn_s2/SWID, CBS
  sessions, authorization headers, and similar secrets are stripped.
*/
(function () {
  "use strict";

  const PROVIDERS = {
    sleeper: { label: "Sleeper", status: "live", icon: "🏈", connectionMode: "provider", readOnly: true },
    yahoo: { label: "Yahoo", status: "pending", icon: "🟣", connectionMode: "oauth", readOnly: true },
    espn: { label: "ESPN", status: "beta", icon: "🔴", connectionMode: "backend", readOnly: true },
    cbs: { label: "CBS", status: "beta", icon: "🔵", connectionMode: "browser-assisted", readOnly: true },
  };

  const STORAGE_KEY = "innerSanctum_leagueConnections";
  const SCHEMA_VERSION = 2;
  const BLOCKED_KEYS = new Set([
    "password", "pass", "passwd", "cookie", "cookies", "token",
    "accessToken", "access_token", "refreshToken", "refresh_token",
    "authorization", "Authorization", "espn_s2", "espnS2", "SWID",
    "swid", "session", "sessionId", "session_id", "cbsToken", "cbsSession"
  ]);

  const TEAM_CONTEXT_FIELDS = [
    "teamId", "teamName", "team", "roster", "scoringFormat",
    "lineupConstruction", "teamCount"
  ];

  /*
    Team-defense identity contract
    ------------------------------
    Weekly Rankings matches a connected roster to ranking rows by exact
    player name. Team defenses are the exception to normal player identity:
    providers may call the same defense "Houston Texans D/ST", "HST", or
    "HOU" while Weekly uses one canonical NFL team code.

    Canonicalize defenses here, at the shared connection boundary, so every
    provider and every connected-league consumer sees the same identity.
    Existing persisted connections are repaired on read because V2 state is
    normalized through normalizeConnection().
  */
  const DEFENSE_TEAM_ALIASES = {
    ARI: "ARI", ARZ: "ARI", ARIZONA: "ARI", ARIZONACARDINALS: "ARI",
    ATL: "ATL", ATLANTA: "ATL", ATLANTAFALCONS: "ATL",
    BAL: "BAL", BLT: "BAL", BALTIMORE: "BAL", BALTIMORERAVENS: "BAL",
    BUF: "BUF", BUFFALO: "BUF", BUFFALOBILLS: "BUF",
    CAR: "CAR", CAROLINA: "CAR", CAROLINAPANTHERS: "CAR",
    CHI: "CHI", CHICAGO: "CHI", CHICAGOBEARS: "CHI",
    CIN: "CIN", CINCINNATI: "CIN", CINCINNATIBENGALS: "CIN",
    CLE: "CLE", CLEVELAND: "CLE", CLEVELANDBROWNS: "CLE",
    DAL: "DAL", DALLAS: "DAL", DALLASCOWBOYS: "DAL",
    DEN: "DEN", DENVER: "DEN", DENVERBRONCOS: "DEN",
    DET: "DET", DETROIT: "DET", DETROITLIONS: "DET",
    GB: "GB", GBP: "GB", GREENBAY: "GB", GREENBAYPACKERS: "GB",
    HOU: "HOU", HST: "HOU", HOUSTON: "HOU", HOUSTONTEXANS: "HOU",
    IND: "IND", INDIANAPOLIS: "IND", INDIANAPOLISCOLTS: "IND",
    JAX: "JAX", JAC: "JAX", JACKSONVILLE: "JAX", JACKSONVILLEJAGUARS: "JAX",
    KC: "KC", KCC: "KC", KANSASCITY: "KC", KANSASCITYCHIEFS: "KC",
    LV: "LV", LVR: "LV", OAK: "LV", LASVEGAS: "LV", LASVEGASRAIDERS: "LV",
    LAC: "LAC", SD: "LAC", SDC: "LAC", LOSANGELESCHARGERS: "LAC", LACHARGERS: "LAC",
    LAR: "LAR", STL: "LAR", LOSANGELESRAMS: "LAR", LARAMS: "LAR",
    MIA: "MIA", MIAMI: "MIA", MIAMIDOLPHINS: "MIA",
    MIN: "MIN", MINNESOTA: "MIN", MINNESOTAVIKINGS: "MIN",
    NE: "NE", NEP: "NE", NEWENGLAND: "NE", NEWENGLANDPATRIOTS: "NE",
    NO: "NO", NOS: "NO", NEWORLEANS: "NO", NEWORLEANSSAINTS: "NO",
    NYG: "NYG", NEWYORKGIANTS: "NYG", NYGIANTS: "NYG",
    NYJ: "NYJ", NEWYORKJETS: "NYJ", NYJETS: "NYJ",
    PHI: "PHI", PHILADELPHIA: "PHI", PHILADELPHIAEAGLES: "PHI",
    PIT: "PIT", PITTSBURGH: "PIT", PITTSBURGHSTEELERS: "PIT",
    SEA: "SEA", SEATTLE: "SEA", SEATTLESEAHAWKS: "SEA",
    SF: "SF", SFO: "SF", SANFRANCISCO: "SF", SANFRANCISCO49ERS: "SF",
    TB: "TB", TBB: "TB", TAMPA: "TB", TAMPABAY: "TB", TAMPABAYBUCCANEERS: "TB",
    TEN: "TEN", TENNESSEE: "TEN", TENNESSEETITANS: "TEN",
    WSH: "WSH", WAS: "WSH", WFT: "WSH", WASHINGTON: "WSH", WASHINGTONCOMMANDERS: "WSH"
  };

  function defenseAliasKey(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/D\/?ST/g, "")
      .replace(/DEFENSE/g, "")
      .replace(/[^A-Z0-9]/g, "");
  }

  function isDefensePosition(position) {
    const key = String(position || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    return key === "DEF" || key === "DST" || key === "D";
  }

  function normalizeDefenseRoster(roster) {
    if (!Array.isArray(roster)) return roster;

    return roster.map(function (player) {
      if (!player || typeof player !== "object" || !isDefensePosition(player.position || player.pos)) {
        return player;
      }

      const candidates = [player.nflTeam, player.team, player.name, player.displayName];
      let canonical = null;
      for (let i = 0; i < candidates.length; i++) {
        canonical = DEFENSE_TEAM_ALIASES[defenseAliasKey(candidates[i])] || null;
        if (canonical) break;
      }

      if (!canonical) return player;

      return {
        ...player,
        displayName: player.displayName || player.name || canonical,
        name: canonical,
        team: canonical,
        nflTeam: canonical
      };
    });
  }

  function emptyState() {
    return { schemaVersion: SCHEMA_VERSION, activeConnectionId: null, connections: {} };
  }

  function sanitizeValue(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (typeof value !== "object") return value;
    const out = {};
    Object.keys(value).forEach(function (key) {
      if (BLOCKED_KEYS.has(key)) return;
      out[key] = sanitizeValue(value[key]);
    });
    return out;
  }

  function textOrNull(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text || null;
  }

  function leagueIdOf(data) {
    return textOrNull(data?.leagueId ?? data?.league?.id ?? data?.league?.leagueId);
  }
  function teamIdOf(data) {
    return textOrNull(data?.teamId ?? data?.team?.id ?? data?.team?.teamId);
  }
  function leagueNameOf(data) {
    return textOrNull(data?.leagueName ?? data?.league?.name ?? data?.league?.settings?.name);
  }
  function teamNameOf(data) {
    return textOrNull(data?.teamName ?? data?.team?.name);
  }
  function cleanPart(value) {
    return encodeURIComponent(String(value || "unknown").trim().toLowerCase());
  }
  function buildConnectionId(provider, data) {
    const leagueId = leagueIdOf(data);
    const teamId = teamIdOf(data);
    const base = provider + ":" + cleanPart(leagueId || leagueNameOf(data) || "league");
    return teamId ? base + ":" + cleanPart(teamId) : base;
  }

  function teamIdFromConnectionId(provider, connectionId) {
    if (!provider || !connectionId) return null;
    const parts = String(connectionId).split(":");
    if (parts.length < 3 || parts[0] !== provider) return null;
    try {
      return textOrNull(decodeURIComponent(parts.slice(2).join(":")));
    } catch (e) {
      return textOrNull(parts.slice(2).join(":"));
    }
  }

  function sameLeague(a, b) {
    const aId = leagueIdOf(a), bId = leagueIdOf(b);
    if (aId && bId) return aId === bId;
    const aName = leagueNameOf(a), bName = leagueNameOf(b);
    return Boolean(aName && bName && aName === bName);
  }

  function preserveResolvedTeamContext(previous, safe) {
    if (!previous || !teamIdOf(previous)) return safe;
    if (teamIdOf(safe)) return safe;
    if (!sameLeague(previous, safe)) return safe;

    const protectedSafe = { ...safe };
    TEAM_CONTEXT_FIELDS.forEach(function (field) {
      if (previous[field] !== undefined) protectedSafe[field] = previous[field];
    });
    return protectedSafe;
  }

  function normalizeConnection(provider, data, existing) {
    const previous = existing || {};
    let safe = sanitizeValue(data || {});
    safe = preserveResolvedTeamContext(previous, safe);
    const now = new Date().toISOString();
    const merged = {
      ...previous,
      ...safe,
      provider,
      connectionMode: safe.connectionMode || previous.connectionMode || PROVIDERS[provider]?.connectionMode || null,
      readOnly: safe.readOnly ?? previous.readOnly ?? PROVIDERS[provider]?.readOnly ?? true,
      connectedAt: previous.connectedAt || safe.connectedAt || now,
      syncedAt: safe.syncedAt || now,
    };
    merged.leagueId = leagueIdOf(merged);
    merged.leagueName = leagueNameOf(merged);
    merged.teamId = teamIdOf(merged);
    merged.teamName = teamNameOf(merged);
    merged.roster = normalizeDefenseRoster(merged.roster);
    return merged;
  }

  function sameTeamOrUpgradeable(a, b) {
    const aId = teamIdOf(a), bId = teamIdOf(b);
    if (!aId || !bId) return true;
    return aId === bId;
  }

  function writeState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      activeConnectionId: state.activeConnectionId || null,
      connections: sanitizeValue(state.connections || {})
    }));
  }

  function migrateLegacyState(parsed) {
    const next = emptyState();
    const source = parsed?.connections && typeof parsed.connections === "object" ? parsed.connections : {};
    Object.keys(source).forEach(function (provider) {
      if (!PROVIDERS[provider] || !source[provider] || typeof source[provider] !== "object") return;
      const connection = normalizeConnection(provider, source[provider], null);
      const id = buildConnectionId(provider, connection);
      connection.connectionId = id;
      next.connections[id] = connection;
      if (parsed.activeProvider === provider) next.activeConnectionId = id;
    });
    if (!next.activeConnectionId) next.activeConnectionId = Object.keys(next.connections)[0] || null;
    return next;
  }

  function normalizeV2State(parsed) {
    const next = emptyState();
    const source = parsed?.connections && typeof parsed.connections === "object" ? parsed.connections : {};
    Object.keys(source).forEach(function (id) {
      const raw = source[id];
      if (!raw || typeof raw !== "object" || !PROVIDERS[raw.provider]) return;

      let repairableRaw = raw;
      if (!teamIdOf(raw)) {
        const keyedTeamId = teamIdFromConnectionId(raw.provider, id);
        if (keyedTeamId) repairableRaw = { ...raw, teamId: keyedTeamId };
      }

      const connection = normalizeConnection(raw.provider, repairableRaw, repairableRaw);
      connection.connectionId = id;
      next.connections[id] = connection;
    });
    next.activeConnectionId = parsed?.activeConnectionId && next.connections[parsed.activeConnectionId]
      ? parsed.activeConnectionId
      : (Object.keys(next.connections)[0] || null);
    return next;
  }

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return emptyState();
      if (parsed.schemaVersion === SCHEMA_VERSION) return normalizeV2State(parsed);
      const migrated = migrateLegacyState(parsed);
      writeState(migrated);
      return migrated;
    } catch (e) {
      return emptyState();
    }
  }

  function allConnections(state) {
    return Object.keys(state.connections).map(function (id) { return state.connections[id]; }).sort(function (a, b) {
      const at = Date.parse(a.syncedAt || a.connectedAt || 0) || 0;
      const bt = Date.parse(b.syncedAt || b.connectedAt || 0) || 0;
      return bt - at;
    });
  }

  function providerConnections(state, provider) {
    return allConnections(state).filter(function (c) { return c.provider === provider; });
  }

  function findExisting(state, provider, data) {
    if (data?.connectionId && state.connections[data.connectionId]) {
      return { id: data.connectionId, connection: state.connections[data.connectionId] };
    }
    const matches = providerConnections(state, provider).filter(function (candidate) {
      return sameLeague(candidate, data) && sameTeamOrUpgradeable(candidate, data);
    });
    if (!matches.length) return null;
    const wantedTeam = teamIdOf(data);
    if (wantedTeam) {
      const exact = matches.find(function (candidate) { return teamIdOf(candidate) === wantedTeam; });
      if (exact) return { id: exact.connectionId, connection: exact };
    }
    const unresolved = matches.find(function (candidate) { return !teamIdOf(candidate); });
    const chosen = unresolved || matches[0];
    return { id: chosen.connectionId, connection: chosen };
  }

  function emitChanged(detail) {
    try {
      window.dispatchEvent(new CustomEvent("innerSanctum:leagueContextChanged", { detail: detail || {} }));
    } catch (e) {}
  }

  function upsert(provider, data, forcedId) {
    if (!PROVIDERS[provider]) throw new Error("Unknown league provider: " + provider);
    if (!data || typeof data !== "object") throw new Error("LeagueConnection.connect requires connection data.");
    const state = readState();
    const existingMatch = forcedId && state.connections[forcedId]
      ? { id: forcedId, connection: state.connections[forcedId] }
      : findExisting(state, provider, data);
    const connection = normalizeConnection(provider, data, existingMatch?.connection || null);
    const newId = buildConnectionId(provider, connection);
    connection.connectionId = newId;
    if (existingMatch && existingMatch.id !== newId) delete state.connections[existingMatch.id];
    state.connections[newId] = connection;
    state.activeConnectionId = newId;
    writeState(state);
    emitChanged({ type: "upsert", connectionId: newId, provider: provider });
    return connection;
  }

  const LeagueConnection = {
    PROVIDERS,
    STORAGE_KEY,
    SCHEMA_VERSION,

    getActiveConnectionId() { return readState().activeConnectionId; },
    getActiveConnection() {
      const state = readState();
      return state.activeConnectionId ? state.connections[state.activeConnectionId] || null : null;
    },
    getActiveProvider() { return this.getActiveConnection()?.provider || null; },
    getAllConnections() { return allConnections(readState()); },
    getConnectionsByProvider(provider) { return PROVIDERS[provider] ? providerConnections(readState(), provider) : []; },
    getConnectionById(id) { return readState().connections[id] || null; },

    /* Legacy compatibility: one representative connection per provider. */
    getConnections() {
      const state = readState();
      const active = state.activeConnectionId ? state.connections[state.activeConnectionId] : null;
      const out = {};
      Object.keys(PROVIDERS).forEach(function (provider) {
        const list = providerConnections(state, provider);
        if (!list.length) return;
        out[provider] = active && active.provider === provider ? active : list[0];
      });
      return out;
    },

    getConnection(provider) {
      if (!PROVIDERS[provider]) return null;
      const active = this.getActiveConnection();
      if (active?.provider === provider) return active;
      return this.getConnectionsByProvider(provider)[0] || null;
    },
    isConnected(provider) { return this.getConnectionsByProvider(provider).length > 0; },
    hasAnyConnection() { return this.getAllConnections().length > 0; },

    connect(provider, data) { return upsert(provider, data, null); },
    update(provider, data) {
      const active = this.getActiveConnection();
      const existing = active?.provider === provider ? active : this.getConnection(provider);
      if (!existing) throw new Error("Cannot update provider that is not connected: " + provider);
      return upsert(provider, data || {}, existing.connectionId);
    },
    updateConnection(connectionId, data) {
      const existing = this.getConnectionById(connectionId);
      if (!existing) throw new Error("Cannot update unknown connection: " + connectionId);
      return upsert(existing.provider, data || {}, connectionId);
    },

    setActiveConnection(connectionId) {
      const state = readState();
      if (connectionId !== null && !state.connections[connectionId]) {
        throw new Error("Cannot activate unknown connection: " + connectionId);
      }
      state.activeConnectionId = connectionId;
      writeState(state);
      emitChanged({ type: "activate", connectionId: connectionId });
      return connectionId ? state.connections[connectionId] : null;
    },

    setActiveProvider(provider) {
      if (provider === null) return this.setActiveConnection(null);
      if (!PROVIDERS[provider]) throw new Error("Unknown league provider: " + provider);
      const connection = this.getConnectionsByProvider(provider)[0];
      if (!connection) throw new Error("Cannot activate a provider that is not connected: " + provider);
      return this.setActiveConnection(connection.connectionId);
    },

    disconnectConnection(connectionId) {
      const state = readState();
      if (!state.connections[connectionId]) return;
      delete state.connections[connectionId];
      if (state.activeConnectionId === connectionId) {
        state.activeConnectionId = allConnections(state)[0]?.connectionId || null;
      }
      writeState(state);
      emitChanged({ type: "disconnect", connectionId: connectionId });
    },

    /* Legacy provider disconnect removes one connection, not every league. */
    disconnect(provider) {
      const active = this.getActiveConnection();
      const target = active?.provider === provider ? active : this.getConnection(provider);
      if (target) this.disconnectConnection(target.connectionId);
    },

    disconnectAll() {
      writeState(emptyState());
      emitChanged({ type: "disconnectAll" });
    },

    getSummary() {
      const state = readState();
      return {
        schemaVersion: SCHEMA_VERSION,
        activeConnectionId: state.activeConnectionId,
        activeProvider: this.getActiveProvider(),
        connectionCount: Object.keys(state.connections).length,
        connectedProviders: Array.from(new Set(allConnections(state).map(function (c) { return c.provider; }))),
        providers: PROVIDERS,
      };
    },
  };

  window.LeagueConnection = LeagueConnection;

  /*
    Load shared browser context helpers on pages that include LeagueConnection.
    Weekly gets one additional identity pass so provider display-name variants
    resolve to Weekly's canonical row names before My Roster filtering.
  */
  if (typeof document !== "undefined") {
    function appendScriptOnce(src, dataAttribute, onload) {
      if (document.querySelector('script[' + dataAttribute + ']')) {
        if (onload) onload();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.defer = true;
      script.setAttribute(dataAttribute, "1");
      if (onload) script.addEventListener("load", onload, { once: true });
      document.head.appendChild(script);
    }

    function loadBrowserContext() {
      appendScriptOnce("/team-context.js", "data-inner-sanctum-team-context");

      if (/^\/weekly(?:\.html)?\/?$/i.test(window.location.pathname)) {
        appendScriptOnce("/player-identity.js", "data-inner-sanctum-player-identity", function () {
          appendScriptOnce("/weekly-roster-identity.js", "data-inner-sanctum-weekly-roster-identity");
        });
      }
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", loadBrowserContext, { once: true });
    } else {
      loadBrowserContext();
    }
  }
})();