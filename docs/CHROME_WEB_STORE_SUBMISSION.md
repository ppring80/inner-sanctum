# Chrome Web Store submission — Inner Sanctum Connect

## Store identity

**Name:** The Inner Sanctum — Connect

**Single purpose:** Read-only browser helper that lets a customer connect an already-authenticated ESPN or CBS fantasy-football league to The Inner Sanctum so the site can provide league-, roster-, and lineup-aware fantasy analysis.

**Short description:** Read-only fantasy league connection helper for The Inner Sanctum.

## User-facing behavior

The extension runs only on supported CBS Fantasy Football pages, ESPN Fantasy Football pages, and The Inner Sanctum's Link Your League page. A customer initiates a connection from The Inner Sanctum. The extension reads the minimum fantasy-league information needed to identify the selected league and team and to build a sanitized fantasy snapshot such as league/team identity, roster, settings, standings, schedule, matchup context, and provider-reported availability where supported.

The extension does not place fantasy transactions, change lineups, add/drop players, or ask customers to paste fantasy-provider passwords, cookies, SWID, espn_s2 values, authorization headers, or DevTools output.

## Important ESPN authentication disclosure

The current ESPN connector uses the customer's already-authenticated ESPN browser session. `espn-main-bridge.js` reads the ESPN `SWID` value from the ESPN page's `document.cookie` only to match the authenticated ESPN owner to the correct fantasy team when the team cannot be determined from the page URL. The raw SWID value is not included in the sanitized league snapshot sent to The Inner Sanctum.

Do **not** state in Chrome Web Store privacy disclosures that the extension never accesses browser authentication information. Google classifies authentication cookies as sensitive user data. The accurate disclosure is that the extension uses the customer's existing authenticated ESPN session and may read an ESPN authentication identifier locally for the user-requested league connection, while excluding that raw identifier from the fantasy snapshot.

## Permissions rationale

- `tabs`: find or activate the customer's already-open CBS/ESPN league tab and return the user to The Inner Sanctum after a requested connection.
- `scripting`: deliver the sanitized league snapshot and connection status into The Inner Sanctum's Link Your League page.
- `storage`: keep short-lived extension connection state while an ESPN sign-in/league-selection flow is in progress.
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

## Limited Use statement for the public privacy policy

Before publication, the public privacy policy used in the Chrome Web Store should include an affirmative statement substantially equivalent to:

> The use of information received through the Inner Sanctum Connect browser extension will comply with the Chrome Web Store User Data Policy, including the Limited Use requirements. Extension data is used only to provide or improve the user-requested fantasy-league connection and related Inner Sanctum features, except where disclosure is required by law or necessary for security.

The public policy should also state clearly that the browser helper may use the customer's existing authenticated fantasy-provider session to perform a requested sync, that raw provider passwords are not collected, and that raw ESPN authentication identifiers are not included in the sanitized fantasy-league snapshot.

## Store assets / package gate

The Web Store upload ZIP must contain `manifest.json` at the ZIP root, the JavaScript files referenced by the manifest, and `icons/icon-16.png`, `icon-32.png`, `icon-48.png`, and `icon-128.png`. Do not include `__MACOSX`, repository metadata, tests, or unrelated site files in the upload ZIP.

At least one Web Store screenshot will be needed for the listing. Use a real Inner Sanctum Link Your League / connection-state screen and do not include customer credentials, cookies, account identifiers, or private league information.
