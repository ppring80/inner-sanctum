/*
  THE INNER SANCTUM — league-connection.js
  -------------------------------------------
  Shared fantasy-league connection state.

  Include this file on any Inner Sanctum page that needs to know:

    - whether a fantasy league has been connected
    - which provider is active
    - safe connection metadata for that provider

  <script src="/league-connection.js"></script>

  IMPORTANT ARCHITECTURE
  -------------------------------------------

  This file is ONLY the shared connection-state layer.

  It does NOT:

    - authenticate with fantasy providers
    - call provider APIs
    - inspect browser cookies
    - store provider passwords
    - store OAuth secrets
    - normalize provider league data

  Provider-specific authentication/data collection belongs elsewhere:

    Sleeper
      Existing Sleeper integration.

    Yahoo
      Official Yahoo API/OAuth path when access is available.

    ESPN
      ESPN backend integration.

    CBS
      cbs-browser-connector.js
      Browser-assisted, read-only CBS league capture.

  Provider normalization belongs in:

      provider-adapters.js


  PROVIDER STATUS MEANINGS
  -------------------------------------------

  live
    Production-supported and considered broadly reliable.

  beta
    Real integration exists and has been proven against real league
    data, but still needs broader production testing across additional
    leagues/configurations.

  pending
    Integration depends on external approval/access before it can be
    completed.

  planned
    Product/integration direction exists but the functional connection
    mechanism has not yet been proven.


  CURRENT PROVIDER STRATEGY
  -------------------------------------------

  Sleeper
    - LIVE
    - Existing supported integration.

  Yahoo
    - PENDING
    - Waiting on official Yahoo Fantasy API access/approval.
    - Should use supported Yahoo OAuth/API rather than unofficial
      browser/session workarounds.

  ESPN
    - BETA
    - Real backend integration exists.
    - Remains beta until proven across a broader range of ESPN leagues.

  CBS
    - BETA
    - Browser-assisted, READ-ONLY integration has been proven against
      a real CBS Commissioner fantasy-football league.
    - CBS users authenticate normally with CBS in their own browser.
    - Inner Sanctum reads only fantasy information CBS has already
      exposed to that authenticated browser session.
    - Proven CBS data surfaces include:
        league identity
        fantasy team identity
        roster
        CBS player IDs
        player positions
        NFL teams
        roster status
        standings
        divisions
        points for / points against
        schedule
        opponent CBS team IDs
        home / away
        roster settings
        lineup requirements
        scoring rules
        scoring format
        playoff structure
    - CBS connection is intentionally READ ONLY.
    - No CBS password collection.
    - No cookie extraction into LeagueConnection state.
    - No CAPTCHA bypass.
    - No lineup or transaction writes.
    - Remains beta until tested across additional CBS league formats
      and configurations.


  SECURITY RULE
  -------------------------------------------

  localStorage contains ONLY safe connection metadata and sanitized
  league data needed by Inner Sanctum.

  NEVER store secrets here, including:

    - provider passwords
    - browser cookies
    - CBS session/access tokens
    - ESPN espn_s2
    - ESPN SWID
    - Yahoo OAuth access tokens
    - Yahoo refresh tokens
    - authorization headers
    - CAPTCHA data
*/

(function () {
  "use strict";

  /*
    ================================================================
    PROVIDER REGISTRY
    ================================================================
  */

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

    /*
      ESPN integration exists and works, but remains beta until it is
      battle-tested against a broader range of real ESPN leagues.
    */

    espn: {
      label: "ESPN",
      status: "beta",
      icon: "🔴",
      connectionMode: "backend",
      readOnly: true,
    },

    /*
      CBS browser-assisted integration has now been proven against a
      real CBS Commissioner league.

      The user logs into CBS normally.

      cbs-browser-connector.js performs a READ-ONLY collection of
      sanitized fantasy league data exposed to that browser session.

      No CBS credential or session secret belongs in this state layer.
    */

    cbs: {
      label: "CBS",
      status: "beta",
      icon: "🔵",
      connectionMode: "browser-assisted",
      readOnly: true,
    },
  };

  /*
    ================================================================
    STORAGE
    ================================================================
  */

  const STORAGE_KEY =
    "innerSanctum_leagueConnections";

  function emptyState() {
    return {
      activeProvider: null,
      connections: {},
    };
  }

  function readState() {
    /*
      FUTURE:
      Once Inner Sanctum user accounts persist league connections on
      the backend, this local state can become a cache/fallback around
      an account-level endpoint such as:

        /.netlify/functions/get-league-connections

      Until then, localStorage is the shared site-wide connection state.
    */

    try {
      const raw =
        localStorage.getItem(
          STORAGE_KEY
        );

      if (!raw) {
        return emptyState();
      }

      const parsed =
        JSON.parse(raw);

      /*
        Defensive validation so a damaged/localStorage value does not
        break every connected-league page.
      */

      if (
        !parsed ||
        typeof parsed !== "object"
      ) {
        return emptyState();
      }

      return {
        activeProvider:
          typeof parsed.activeProvider ===
          "string"
            ? parsed.activeProvider
            : null,

        connections:
          parsed.connections &&
          typeof parsed.connections ===
            "object"
            ? parsed.connections
            : {},
      };
    } catch (e) {
      return emptyState();
    }
  }

  function writeState(state) {
    /*
      SECURITY:

      This function must never be used to persist provider secrets.

      Safe examples:

        provider
        leagueId
        leagueName
        teamId
        teamName
        season
        scoringFormat
        teamCount
        connectionMode
        connectedAt
        syncedAt
        sanitized league/roster data

      Unsafe examples:

        password
        cookie
        token
        accessToken
        refreshToken
        espn_s2
        SWID
        authorization header
    */

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(state)
    );
  }

  /*
    ================================================================
    SAFE CONNECTION SANITIZATION
    ================================================================

    LeagueConnection should not rely on every provider flow remembering
    to remove secrets.

    Strip known secret-shaped fields before anything reaches storage.

    This is defense-in-depth, not a substitute for provider-specific
    secure handling.
  */

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

  function sanitizeValue(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(
        sanitizeValue
      );
    }

    if (
      typeof value !==
      "object"
    ) {
      return value;
    }

    const output = {};

    Object.keys(value).forEach(
      function (key) {
        if (
          BLOCKED_KEYS.has(key)
        ) {
          return;
        }

        output[key] =
          sanitizeValue(
            value[key]
          );
      }
    );

    return output;
  }

  /*
    ================================================================
    CONNECTION OBJECT
    ================================================================
  */

  const LeagueConnection = {
    PROVIDERS,

    /*
      ------------------------------------------------
      READS
      ------------------------------------------------
    */

    getActiveProvider() {
      return (
        readState()
          .activeProvider
      );
    },

    getConnections() {
      return (
        readState()
          .connections
      );
    },

    getConnection(provider) {
      return (
        readState()
          .connections[
            provider
          ] || null
      );
    },

    isConnected(provider) {
      return Boolean(
        readState()
          .connections[
            provider
          ]
      );
    },

    hasAnyConnection() {
      return (
        Object.keys(
          readState()
            .connections
        ).length > 0
      );
    },

    /*
      Returns the currently active connection object or null.
    */

    getActiveConnection() {
      const state =
        readState();

      if (
        !state.activeProvider
      ) {
        return null;
      }

      return (
        state.connections[
          state.activeProvider
        ] || null
      );
    },

    /*
      ------------------------------------------------
      CONNECTION WRITE
      ------------------------------------------------

      data may contain safe metadata and sanitized league information.

      Provider secrets are removed before persistence.
    */

    connect(provider, data) {
      if (
        !PROVIDERS[
          provider
        ]
      ) {
        throw new Error(
          "Unknown league provider: " +
          provider
        );
      }

      if (
        !data ||
        typeof data !==
          "object"
      ) {
        throw new Error(
          "LeagueConnection.connect requires connection data."
        );
      }

      const state =
        readState();

      const safeData =
        sanitizeValue(
          data
        );

      const existing =
        state.connections[
          provider
        ] || {};

      const now =
        new Date()
          .toISOString();

      state.connections[
        provider
      ] = {
        ...existing,
        ...safeData,

        provider,

        connectionMode:
          safeData
            .connectionMode ||
          PROVIDERS[
            provider
          ].connectionMode ||
          null,

        readOnly:
          safeData
            .readOnly ??
          PROVIDERS[
            provider
          ].readOnly ??
          true,

        connectedAt:
          existing
            .connectedAt ||
          safeData
            .connectedAt ||
          now,

        syncedAt:
          safeData
            .syncedAt ||
          now,
      };

      state.activeProvider =
        provider;

      writeState(
        state
      );

      return state.connections[
        provider
      ];
    },

    /*
      ------------------------------------------------
      SYNC EXISTING CONNECTION
      ------------------------------------------------

      Used when a provider such as CBS refreshes its sanitized league
      data after the original connection.

      connectedAt is preserved.
      syncedAt is refreshed.
    */

    update(provider, data) {
      if (
        !PROVIDERS[
          provider
        ]
      ) {
        throw new Error(
          "Unknown league provider: " +
          provider
        );
      }

      const state =
        readState();

      const existing =
        state.connections[
          provider
        ];

      if (!existing) {
        throw new Error(
          "Cannot update provider that is not connected: " +
          provider
        );
      }

      const safeData =
        sanitizeValue(
          data || {}
        );

      state.connections[
        provider
      ] = {
        ...existing,
        ...safeData,

        provider,

        connectedAt:
          existing
            .connectedAt,

        syncedAt:
          new Date()
            .toISOString(),
      };

      writeState(
        state
      );

      return state.connections[
        provider
      ];
    },

    /*
      ------------------------------------------------
      ACTIVE PROVIDER
      ------------------------------------------------
    */

    setActiveProvider(provider) {
      if (
        provider !== null &&
        !PROVIDERS[
          provider
        ]
      ) {
        throw new Error(
          "Unknown league provider: " +
          provider
        );
      }

      const state =
        readState();

      if (
        provider &&
        !state.connections[
          provider
        ]
      ) {
        throw new Error(
          "Cannot activate a provider that is not connected: " +
          provider
        );
      }

      state.activeProvider =
        provider;

      writeState(
        state
      );
    },

    /*
      ------------------------------------------------
      DISCONNECT
      ------------------------------------------------
    */

    disconnect(provider) {
      const state =
        readState();

      delete state.connections[
        provider
      ];

      if (
        state.activeProvider ===
        provider
      ) {
        const remaining =
          Object.keys(
            state.connections
          );

        state.activeProvider =
          remaining.length
            ? remaining[0]
            : null;
      }

      writeState(
        state
      );
    },

    disconnectAll() {
      writeState(
        emptyState()
      );
    },

    /*
      ------------------------------------------------
      DIAGNOSTICS
      ------------------------------------------------

      Returns safe provider/connection metadata useful for debugging
      the Link League screen.

      No blocked credential fields are returned because those fields
      should never have entered storage.
    */

    getSummary() {
      const state =
        readState();

      return {
        activeProvider:
          state.activeProvider,

        connectedProviders:
          Object.keys(
            state.connections
          ),

        providers:
          PROVIDERS,
      };
    },
  };

  /*
    ================================================================
    PUBLIC API
    ================================================================
  */

  window.LeagueConnection =
    LeagueConnection;
})();
