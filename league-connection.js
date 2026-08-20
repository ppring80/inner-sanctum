/*
  THE INNER SANCTUM — league-connection.js
  -------------------------------------------
  Shared connection state, following the same pattern as
  shared-player-data.js. Include this on any page that needs to
  know which fantasy platform (if any) the user has connected.

  <script src="league-connection.js"></script>

  Flip a provider's status from "pending"/"planned"/"beta" to "live"
  once the real authentication + provider adapter has been proven
  reliable in production.

  Provider strategy:

  Sleeper
    - Live.

  Yahoo
    - Pending official API access / approval.

  ESPN
    - Beta.
    - Real backend integration exists, but remains beta until it is
      proven across a broader range of real leagues.

  CBS
    - Planned.
    - IMPORTANT: CBS is NOT blocked as a platform.
    - The earlier server-side username/password login experiment was
      abandoned because CBS login is protected by browser/reCAPTCHA
      flows that should not be bypassed.
    - Current integration direction is browser-assisted authentication:
        1. User logs into CBS normally in their browser.
        2. Inner Sanctum recognizes the authenticated CBS fantasy league.
        3. Read-only league context is collected from data CBS already
           exposes to the authenticated browser.
        4. CBS data is normalized through provider-adapters.js.
    - Initial CBS scope is READ ONLY:
        league identity
        team identity
        rosters
        scoring/settings
        standings/schedule
        transactions
        draft state/results if available
    - No CBS password collection.
    - No CAPTCHA bypass.
    - No write operations to CBS in Phase 1.
*/

(function () {
  const PROVIDERS = {
    sleeper: {
      label: "Sleeper",
      status: "live",
      icon: "🏈",
    },

    yahoo: {
      label: "Yahoo",
      status: "pending",
      icon: "🟣",
    },

    // Real backend exists (espn-league.js), but remains beta until
    // battle-tested across a wider range of real ESPN leagues.
    espn: {
      label: "ESPN",
      status: "beta",
      icon: "🔴",
    },

    // CBS proof-of-concept path confirmed:
    //
    // Authenticated CBS fantasy league pages expose league-specific
    // information to the user's browser, including structured roster
    // state and CBS fantasy API plumbing.
    //
    // We are therefore pursuing a browser-assisted READ-ONLY connector
    // rather than attempting server-side CBS username/password login.
    //
    // The connection/auth transport and CBS normalization layer still
    // need to be built, so this remains "planned" until functional.
    cbs: {
      label: "CBS",
      status: "planned",
      icon: "🔵",
    },
  };

  const STORAGE_KEY = "innerSanctum_leagueConnections";

  function readState() {
    /*
      TODO:
      Once user accounts are backend-tracked, replace or supplement this
      local state with a fetch to a Netlify function such as:

        /.netlify/functions/get-league-connections

      Provider authentication/session material must NOT be stored here.
      localStorage should contain connection metadata only.
    */

    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      return raw
        ? JSON.parse(raw)
        : {
            activeProvider: null,
            connections: {},
          };
    } catch (e) {
      return {
        activeProvider: null,
        connections: {},
      };
    }
  }

  function writeState(state) {
    /*
      TODO:
      Pair this with a backend save-league-connection function once
      account-level connection persistence is implemented.

      SECURITY:
      Never store provider passwords, CBS access tokens, cookies,
      ESPN session cookies, Yahoo OAuth secrets, or other sensitive
      authentication material in this localStorage object.

      Store only safe connection metadata such as:
        provider
        leagueId
        leagueName
        teamId
        teamName
        season
        connectedAt
        connectionMode
    */

    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  const LeagueConnection = {
    PROVIDERS,

    getActiveProvider() {
      return readState().activeProvider;
    },

    getConnections() {
      return readState().connections;
    },

    getConnection(provider) {
      return readState().connections[provider] || null;
    },

    isConnected(provider) {
      return Boolean(readState().connections[provider]);
    },

    hasAnyConnection() {
      return Object.keys(readState().connections).length > 0;
    },

    connect(provider, data) {
      if (!PROVIDERS[provider]) {
        throw new Error(`Unknown league provider: ${provider}`);
      }

      const state = readState();

      state.connections[provider] = {
        ...data,
        provider,
        connectedAt: data?.connectedAt || new Date().toISOString(),
      };

      state.activeProvider = provider;

      writeState(state);
    },

    disconnect(provider) {
      const state = readState();

      delete state.connections[provider];

      if (state.activeProvider === provider) {
        state.activeProvider = null;
      }

      writeState(state);
    },

    disconnectAll() {
      writeState({
        activeProvider: null,
        connections: {},
      });
    },
  };

  window.LeagueConnection = LeagueConnection;
})();
