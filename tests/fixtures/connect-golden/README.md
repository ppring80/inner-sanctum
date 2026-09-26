# connect-golden fixtures (Phase 0 — mobile league-connect project)

Golden baselines that freeze the proven DESKTOP CBS and ESPN connection
behavior before any mobile work begins.

- `*.input.json` — representative capture objects fed INTO production code.
  Their shape mirrors what the real capture code returns:
  `CBSBrowserConnector.captureAll()` (cbs-extension/cbs-browser-connector.js)
  and the ESPN main bridge `fetchLeague()` (cbs-extension/espn-main-bridge.js).
  Each includes a team defense so defense-identity normalization is exercised.
- `*.golden.json` — OBSERVED OUTPUT of the current production code, recorded
  by `node scripts/record-connect-golden.js`. Never edit these by hand.
  `syncedAt`/`connectedAt` are normalized to `<normalized-timestamp>`.

Re-recording is an intentional behavior change: run the recorder, review the
diff, and explain it in the PR.
