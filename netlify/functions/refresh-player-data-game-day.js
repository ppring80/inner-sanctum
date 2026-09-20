// Sunday game-day alias for the league-wide player/injury cache refresh.
// The shared handler retains the same authorization, parallel 32-team fetch,
// and Netlify Blobs write path as the regular scheduled refresh.
exports.handler = require("./refresh-player-data.js").handler;
