/*
  THE INNER SANCTUM — league-connection.js
  -------------------------------------------
  Shared fantasy-league connection state.

  V2 ARCHITECTURE
  -------------------------------------------
  A customer can have MANY league/team connections, including multiple
  leagues on the same provider. One connection is active at a time and
  becomes the context consumed by Weekly Rankings and other tools.

  Storage V2:

    {
      schemaVersion: 2,
      activeConnectionId: "espn:1094040685:7",
      connections: {
        "espn:1094040685:7": { ... },
        "espn:99887766:3": { ... },
        "cbs:12345:10": { ... }
      }
    }

  Existing V1 state ({ activeProvider, connections: { espn: {...} } })
  is migrated automatically and preserved. Legacy read methods remain
  available so existing pages can move to connection-aware behavior
  incrementally without breaking.

  IMPORTANT SECURITY BOUNDARY
  -------------------------------------------
  localStorage contains ONLY safe connection metadata and sanitized
  league data. Provider passwords, cookies, OAuth tokens, ESPN espn_s2,
  ESPN SWID, CBS sessions, authorization headers, and similar secrets
  must never be persisted here.
*/

(function () {
  "use strict";

  const PROVIDERS = {
    sleeper: {
      label: "Sleeper",
      status: "live",
      icon: "🏈",
      connectionMode: "provider",
      readOnly: true,
    },
    yahoo: {
      label: "Yahoo",
      status: "pending",
      icon: "🟣",
      connectionMode: "oauth",
      readOnly: true,
    },
    espn: {
      label: "ESPN",
      status: "beta",
      icon: "🔴",
      connectionMode: "backend",
      readOnly: true,
    },
    cbs: {
      label: "CBS",
      status: "beta",
      icon: "🔵",
      connectionMode: "browser-assisted",
      readOnly: true,
    },
  };

  const STORAGE_KEY = "innerSanctum_leagueConnections";
  const SCHEMA_VERSION = 2;

  const BLOCKED_KEYS = new Set([
    "password",
    "pass",
    "passwd",
    "cookie",
    "cookies",
    "token",
    "accessToken",
    "access_token",
    "refreshToken",
    "refresh_token",
    "authorization",
    "Authorization",
    "espn_s2",
    "espnS2",
    "SWID",
    "swid",
    "session",
    "sessionId",
    "session_id",
    "cbsToken",
    "cbsSession",
  ]);

  function emptyState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      activeConnectionId: null,
      connections: {},
    };
  }

  function sanitizeValue(value) {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (typeof value !== "object") return value;

    const output = {};
    Object.keys(value).forEach(function (key) {
      if (BLOCKED_KEYS.has(key)) return;
      output[key] = sanitizeValue(value[key]);
    });
    return output;
  }

  function textOrNull(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text : null;
  }

  function getLeagueId(data) {
    return textOrNull(
      data?.leagueId ??
      data?.league?.id ??
      data?.league?.leagueId
    );
  }

  function getTeamId(data) {
    return textOrNull(
      data?.teamId ??
      data?.team?.id ??
      data?.team?.teamId
    );
  }

  function getLeagueName(data) {
    return textOrNull(
      data?.leagueName ??
      data?.league?.name
    );
  }

  function getTeamName(data) {
    return textOrNull(
      data?.teamName ??
      data?.team?.name
    );
  }

  function cleanConnectionPart(value) {
    return encodeURIComponent(String(value || "unknown").trim().toLowerCase());
  }

  function buildConnectionId(provider, data) {
    const leagueId = getLeagueId(data);
    const teamId = getTeamId(data);
    const leagueFallback = getLeagueName(data) || "league";
    const base = provider + ":" + cleanConnectionPart(leagueId || leagueFallback);
    return teamId ? base + ":" + cleanConnectionPart(teamId) : base;
  }

  function sameLeague(a, b) {
    const aLeagueId = getLeagueId(a);
    const bLeagueId = getLeagueId(b);

    if (aLeagueId && bLeagueId) return aLeagueId === bLeagueId;

    const aName = getLeagueName(a);
    const bName = getLeagueName(b);
    return Boolean(aName && bName && aName === bName);
  }

  function sameTeamOrUpgradeable(existing, incoming) {
    const existingTeamId = getTeamId(existing);
    const incomingTeamId = getTeamId(incoming);

    if (!existingTeamId || !incomingTeamId) return true;
    return existingTeamId === incomingTeamId;
  }

  function normalizeConnection(provider, data, existing) {
    const safeData = sanitizeValue(data || {});
    const previous = existing || {};
    const now = new Date().toISOString();

    const merged = {
      ...previous,
      ...safeData,
      provider,
      connectionMode:
        safeData.connectionMode ||
        previous.connectionMode ||
        PROVIDERS[provider]?.connectionMode ||
        null,
      readOnly:
        safeData.readOnly ??
        previous.readOnly ??
        PROVIDERS[provider]?.readOnly ??
        true,
      connectedAt:
        previous.connectedAt ||
        safeData.connectedAt ||
        now,
      syncedAt:
        safeData.syncedAt ||
        now,
    };

    merged.leagueId = getLeagueId(merged);
    merged.leagueName = getLeagueName(merged);
    merged.teamId = getTeamId(merged);
    merged.teamName = getTeamName(merged);

    return merged;
  }

  function migrateLegacyState(parsed) {
    const next = emptyState();
    const legacyConnections =
      parsed?.connections && typeof parsed.connections === "object"
        ? parsed.connections
        : {};

    Object.keys(legacyConnections).forEach(function (provider) {
      if (!PROVIDERS[provider]) return;
      const raw = legacyConnections[provider];
      if (!raw || typeof raw !== "object") return;

      const connection = normalizeConnection(provider, raw, null);
      const id = buildConnectionId(provider, connection);
      connection.connectionId = id;
      next.connections[id] = connection;

      if (parsed.activeProvider === provider) {
        next.activeConnectionId = id;
      }
    });

    if (!next.activeConnectionId) {
      const ids = Object.keys(next.connections);
      next.activeConnectionId = ids.length ? ids[0] : null;
    }

    return next;
  }

  function normalizeV2State(parsed) {
    const next = emptyState();
    const source =
      parsed?.connections && typeof parsed.connections === "object"
        ? parsed.connections
        : {};

    Object.keys(source).forEach(function (id) {
      const raw = source[id];
      const provider = raw?.provider;
      if (!provider || !PROVIDERS[provider] || !raw || typeof raw !== "object") return;

      const connection = normalizeConnection(provider, raw, raw);
      connection.connectionId = id;
      next.connections[id] = connection;
    });

    next.activeConnectionId =
      parsed?.activeConnectionId && next.connections[parsed.activeConnectionId]
        ? parsed.activeConnectionId
        : null;

    if (!next.activeConnectionId) {
      const ids = Object.keys(next.connections);
      next.activeConnectionId = ids.length ? ids[0] : null;
    }

    return next;
  }

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return emptyState();

      if (parsed.schemaVersion === SCHEMA_VERSION) {
        return normalizeV2State(parsed);
      }

      const migrated = migrateLegacyState(parsed);
      writeState(migrated);
      return migrated;
    } catch (e) {
      return emptyState();
    }
  }

  function writeState(state) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        activeConnectionId: state.activeConnectionId || null,
        connections: sanitizeValue(state.connections || {}),
      })
    );
  }

  function allConnections(state) {
    return Object.keys(state.connections)
      .map(function (id) { return state.connections[id]; })
      .sort(function (a, b) {
        const aTime = Date.parse(a.syncedAt || a.connectedAt || 0) || 0;
        const bTime = Date.parse(b.syncedAt || b.connectedAt || 0) || 0;
        return bTime - aTime;
      });
  }

  function findProviderConnections(state, provider) {
    return allConnections(state).filter(function (connection) {
      return connection.provider === provider;
    });
  }

  function findExistingConnection(state, provider, data) {
    const incomingId = textOrNull(data?.connectionId);
    if (incomingId && state.connections[incomingId]) {
      return { id: incomingId, connection: state.connections[incomingId] };
    }

    const matches = findProviderConnections(state, provider).filter(function (candidate) {
      return sameLeague(candidate, data) && sameTeamOrUpgradeable(candidate, data);
    });

    if (!matches.length) return null;

    const exactTeam = getTeamId(data);
    if (exactTeam) {
      const exact = matches.find(function (candidate) {
        return getTeamId(candidate) === exactTeam;
      });
      if (exact) return { id: exact.connectionId, connection: exact };
    }

    const unresolved = matches.find(function (candidate) {
      return !getTeamId(candidate);
    });

    const selected = unresolved || matches[0];
    return { id: selected.connectionId, connection: selected };
  }

  function upsertConnection(provider, data, forceExistingId) {
    if (!PROVIDERS[provider]) {
      throw new Error("Unknown league provider: " + provider);
    }
    if (!data || typeof data !== "object") {
      throw new Error("LeagueConnection.connect requires connection data.");
    }

    const state = readState();
    const existingMatch = forceExistingId && state.connections[forceExistingId]
      ? { id: forceExistingId, connection: state.connections[forceExistingId] }
      : findExistingConnection(state, provider, data);

    const connection = normalizeConnection(
      provider,
      data,
      existingMatch ? existingMatch.connection : null
    );

    const newId = buildConnectionId(provider, connection);
    connection.connectionId = newId;

    if (existingMatch && existingMatch.id !== newId) {
      delete state.connections[existingMatch.id];
    }

    state.connections[newId] = connection;
    state.activeConnectionId = newId;
    writeState(state);

    return connection;
  }

  const LeagueConnection = {
    PROVIDERS,
    STORAGE_KEY,
    SCHEMA_VERSION,

    getActiveConnectionId() {
      return readState().activeConnectionId;
    },

    getActiveConnection() {
      const state = readState();
      return state.activeConnectionId
        ? state.connections[state.activeConnectionId] || null
        : null;
    },

    getActiveProvider() {
      return this.getActiveConnection()?.provider || null;
    },

    getAllConnections() {
      return allConnections(readState());
    },

    getConnectionsByProvider(provider) {
      if (!PROVIDERS[provider]) return [];
      return findProviderConnections(readState(), provider);
    },

    getConnectionById(connectionId) {
      return readState().connections[connectionId] || null;
    },

    /*
      Legacy compatibility: returns one representative connection per
      provider. The active connection wins for its provider; otherwise
      the most recently synced connection is returned.
    */
    getConnections() {
      const state = readState();
      const output = {};
      const active = state.activeConnectionId
        ? state.connections[state.activeConnectionId]
        : null;

      Object.keys(PROVIDERS).forEach(function (provider) {
        const list = findProviderConnections(state, provider);
        if (!list.length) return;
        output[provider] =
          active && active.provider === provider
            ? active
            : list[0];
      });

      return output;
    },

    /* Legacy provider lookup. */
    getConnection(provider) {
      if (!PROVIDERS[provider]) return null;
      const active = this.getActiveConnection();
      if (active && active.provider === provider) return active;
      const list = this.getConnectionsByProvider(provider);
      return list.length ? list[0] : null;
    },

    isConnected(provider) {
      return this.getConnectionsByProvider(provider).length > 0;
    },

    hasAnyConnection() {
      return this.getAllConnections().length > 0;
    },

    connect(provider, data) {
      return upsertConnection(provider, data, null);
    },

    update(provider, data) {
      if (!PROVIDERS[provider]) {
        throw new Error("Unknown league provider: " + provider);
      }

      const active = this.getActiveConnection();
      const existing =
        active && active.provider === provider
          ? active
          : this.getConnection(provider);

      if (!existing) {
        throw new Error("Cannot update provider that is not connected: " + provider);
      }

      return upsertConnection(provider, data || {}, existing.connectionId);
    },

    updateConnection(connectionId, data) {
      const existing = this.getConnectionById(connectionId);
      if (!existing) {
        throw new Error("Cannot update unknown connection: " + connectionId);
      }
      return upsertConnection(existing.provider, data || {}, connectionId);
    },

    setActiveConnection(connectionId) {
      const state = readState();
      if (connectionId !== null && !state.connections[connectionId]) {
        throw new Error("Cannot activate unknown connection: " + connectionId);
      }
      state.activeConnectionId = connectionId;
      writeState(state);
      return connectionId ? state.connections[connectionId] : null;
    },

    /*
      Legacy provider activation. With multiple leagues on one provider,
      the most recently synced connection for that provider is selected.
    */
    setActiveProvider(provider) {
      if (provider === null) {
        this.setActiveConnection(null);
        return;
      }
      if (!PROVIDERS[provider]) {
        throw new Error("Unknown league provider: " + provider);
      }
      const list = this.getConnectionsByProvider(provider);
      if (!list.length) {
        throw new Error("Cannot activate a provider that is not connected: " + provider);
      }
      this.setActiveConnection(list[0].connectionId);
    },

    disconnectConnection(connectionId) {
      const state = readState();
      if (!state.connections[connectionId]) return;

      delete state.connections[connectionId];

      if (state.activeConnectionId === connectionId) {
        const remaining = allConnections(state);
        state.activeConnectionId = remaining.length
          ? remaining[0].connectionId
          : null;
      }

      writeState(state);
    },

    /*
      Legacy behavior adapted for multi-league state: disconnect only the
      currently active (or most recent) connection for that provider,
      never every league on the provider in one silent action.
    */
    disconnect(provider) {
      const active = this.getActiveConnection();
      const target =
        active && active.provider === provider
          ? active
          : this.getConnection(provider);
      if (target) this.disconnectConnection(target.connectionId);
    },

    disconnectAll() {
      writeState(emptyState());
    },

    getSummary() {
      const active = this.getActiveConnection();
      const all = this.getAllConnections();
      return {
        schemaVersion: SCHEMA_VERSION,
        activeConnectionId: active?.connectionId || null,
        activeProvider: active?.provider || null,
        connectionCount: all.length,
        connectedProviders: Array.from(new Set(all.map(function (c) { return c.provider; }))),
        providers: PROVIDERS,
      };
    },
  };

  window.LeagueConnection = LeagueConnection;
})();
