/*
  THE INNER SANCTUM — league-connection.js
  -------------------------------------------
  Shared connection state, following the same pattern as
  shared-player-data.js. Include this on any page that needs to
  know which fantasy platform (if any) the user has connected.

  <script src="league-connection.js"></script>

  Flip a provider's status from "pending"/"planned" to "live" the
  moment real credentials/backend land — every page using this file
  picks it up automatically, no other edits needed for the
  connection layer itself (though the actual fetch/auth flow for
  that provider still needs building — see provider-adapters.js and
  the connect-league.html reference page).

  UPDATED (added CBS): now tracks four providers instead of three.
  ESPN and CBS both ship as "planned" — connect-league.html still
  lets a visitor walk through their connect form and store a
  connection locally (status: "demo"), same pattern Yahoo already
  used on power-rankings.html, so the UI/UX is provable before the
  real backend proxy exists for either.
*/

(function () {
  const PROVIDERS = {
    sleeper: { label: "Sleeper", status: "live", icon: "🏈" },
    yahoo: { label: "Yahoo", status: "pending", icon: "🟣" },
    espn: { label: "ESPN", status: "planned", icon: "🔴" },
    cbs: { label: "CBS", status: "planned", icon: "🔵" },
  };

  const STORAGE_KEY = "innerSanctum_leagueConnections";

  function readState() {
    // TODO: once user accounts are backend-tracked (tied to Patreon
    // login), replace this with a fetch to a Netlify function, e.g.
    // /.netlify/functions/get-league-connections
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { activeProvider: null, connections: {} };
    } catch (e) {
      return { activeProvider: null, connections: {} };
    }
  }

  function writeState(state) {
    // TODO: pair with a POST to a save-league-connection Netlify
    // function once this is backend-tracked instead of local-only.
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
      const state = readState();
      state.connections[provider] = data;
      state.activeProvider = provider;
      writeState(state);
    },

    disconnect(provider) {
      const state = readState();
      delete state.connections[provider];
      if (state.activeProvider === provider) state.activeProvider = null;
      writeState(state);
    },

    disconnectAll() {
      writeState({ activeProvider: null, connections: {} });
    },
  };

  window.LeagueConnection = LeagueConnection;
})();
