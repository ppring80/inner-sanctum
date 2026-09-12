# Chrome Web Store submission — The Inner Sanctum Connect

## Store identity

**Name:** The Inner Sanctum — Connect

**Version:** 0.5.2

**Single purpose:** Read-only browser helper that lets a customer connect an already-authenticated ESPN or CBS fantasy-football league to The Inner Sanctum so the site can provide league-, roster-, lineup-, matchup-, and availability-aware fantasy analysis.

**Short description:** Read-only fantasy league connection helper for The Inner Sanctum.

**Privacy policy URL:** https://theinnersanctum.xyz/chrome-web-store-privacy.html

## User-facing behavior

The extension runs only on supported CBS Fantasy Football pages, ESPN Fantasy Football pages, and The Inner Sanctum's Link Your League page. A customer initiates a connection from The Inner Sanctum. The extension reads the minimum fantasy-league information needed to identify the selected league and team and to build a sanitized fantasy snapshot such as league/team identity, roster, settings, standings, schedule, matchup context, and provider-reported availability where supported.

The extension does not place fantasy transactions, change lineups, add/drop players, or ask customers to paste fantasy-provider passwords, cookies, SWID, espn_s2 values, authorization headers, or DevTools output.

## Important ESPN authentication disclosure

The ESPN connector uses the customer's already-authenticated ESPN browser session. `espn-main-bridge.js` may read the ESPN `SWID` value from the ESPN page's `document.cookie` only to match the authenticated ESPN owner to the correct fantasy team when the team cannot be determined from the page URL. The raw SWID value is not included in the sanitized league snapshot sent to The Inner Sanctum.

Do not state in Chrome Web Store privacy disclosures that the extension never accesses browser authentication information. The accurate disclosure is that the extension uses the customer's existing authenticated ESPN session and may read an ESPN authentication identifier locally for the user-requested league connection, while excluding that raw identifier from the fantasy snapshot.

## Permissions rationale

- `tabs`: find or activate the customer's already-open CBS/ESPN league tab and return the user to The Inner Sanctum after a requested connection.
- `scripting`: deliver the sanitized league snapshot and connection status into The Inner Sanctum's Link Your League page.
- `storage`: keep short-lived extension connection state while a provider sign-in/league-selection flow is in progress.
- `https://*.football.cbssports.com/*`: read fantasy-league pages the customer is already authorized to view and perform same-origin read-only GET requests needed for the requested CBS sync.
- `https://fantasy.espn.com/*`: detect the selected ESPN fantasy league and read the authenticated fantasy page context.
- `https://lm-api-reads.fantasy.espn.com/*`: perform authenticated read-only ESPN Fantasy API requests needed to build the requested league snapshot.
- `https://theinnersanctum.xyz/*` and `https://www.theinnersanctum.xyz/*`: receive the user's connection request and deliver the sanitized league snapshot/status to the Link Your League page.

## Chrome Web Store privacy declarations

Disclose that the extension handles:

- website content / fantasy-league data from supported ESPN and CBS fantasy pages;
- web activity limited to the supported fantasy-provider and Inner Sanctum pages necessary for the user-facing league connection;
- authentication information limited to the existing ESPN authenticated-session context described above;
- persistent identifiers such as fantasy league, team, and player identifiers contained in the requested fantasy snapshot.

Use is limited to the extension's single purpose: connecting the customer's selected fantasy league to Inner Sanctum and providing league-aware fantasy analysis. Do not use or transfer this data for advertising, credit, data brokerage, or unrelated profiling.

## Chrome Web Store dashboard copy

**Detailed description:**

The Inner Sanctum — Connect links fantasy-football leagues you already have access to on ESPN or CBS with The Inner Sanctum. Start the connection from The Inner Sanctum, sign into your fantasy provider normally, and open the league you want to connect. The extension reads the league, team, roster, settings, standings, schedule, matchup context, and provider-reported availability needed to power league-aware Inner Sanctum analysis. The extension is read-only and does not submit lineup changes, transactions, adds, drops, or other fantasy-provider account actions.

**Single-purpose justification:**

Connect an already-authenticated ESPN or CBS fantasy-football league to The Inner Sanctum for league-aware fantasy analysis.

**Remote code:** No. All executable extension code is packaged with the extension. No `eval`, `new Function`, or remote script loading is permitted by the package regression test.

## Package gate

The upload ZIP must contain `manifest.json` at the ZIP root and only the extension runtime files/assets required by the manifest. It must include:

- `manifest.json`
- `service-worker.js`
- `service-worker-v050.js`
- `cbs-browser-connector.js`
- `cbs-content-bridge.js`
- `cbs-main-bridge.js`
- `cbs-free-agent-capture.js`
- `espn-content-bridge.js`
- `espn-main-bridge.js`
- `sanctum-content-bridge.js`
- `icons/icon-16.png`
- `icons/icon-32.png`
- `icons/icon-48.png`
- `icons/icon-128.png`

Do not include `__MACOSX`, repository metadata, tests, docs, or unrelated site files.

## Acceptance gate

Before uploading the exact ZIP:

1. `node tests/chrome-web-store-package.test.js` passes.
2. Connected Stack Lock passes.
3. CBS Connect passes in a fresh Chrome session.
4. ESPN Connect passes in a fresh Chrome session.
5. CBS → ESPN → CBS switching remains stable.
6. The exact ZIP SHA-256 is recorded before upload.
7. Store screenshots contain no customer credentials, cookies, account identifiers, or private-league information.

## Current customer evidence

A real customer has successfully connected to a private ESPN league using the prior accepted extension build. This validates the private-ESPN authentication/connection path, but does not by itself constitute acceptance of version 0.5.2. Version 0.5.2 therefore still requires the acceptance gate above before Web Store upload.
