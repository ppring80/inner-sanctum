# Universal mobile league connect

## Why

CBS and ESPN have no OAuth. On a computer, the Inner Sanctum Connect extension
(or the CBS bookmark) runs inside the customer's own signed-in provider page
and returns a sanitized league capture. Phones and tablets cannot run that
extension, and browsers correctly forbid a website from reading another site's
signed-in pages. So a phone cannot capture a private CBS/ESPN league by itself
without an app or credentials, and we never accept credentials.

Phase 1 therefore moves the **finished, sanitized `LeagueConnection` record**
from a device that already has it to a phone, tablet or another computer.

## Phase 1 (implemented): one-time device handoff

```
Computer (connected league)                     Phone / tablet
───────────────────────────                     ──────────────
Send to my phone
  POST connection-handoff {create, record} ──►  (server stores sanitized record
  ◄── {code, expiresAt}                          under SHA-256(code), 10 min)
QR code + link  /connect-league#handoff=code ─► open link
                                                code removed from address bar
                                                POST {claim, code} ──► one-time
                                                ◄── {record}           claim
                                                LeagueConnection.connect/update
                                                refreshChatGptLinkIfNeeded()
                                                "League connected"
```

- `netlify/functions/connection-handoff.js` — provider-neutral create/claim.
- `mobile-connect.js` — loaded by `connect-league.html` after
  `provider-adapters.js`. Desktop: separate "Send to my phone" panel for a
  connected CBS/ESPN league; never touches the provider forms. Mobile: one
  provider-neutral CBS/ESPN panel. Any device: imports handoff links.

### Handoff link format

Production links use the URL **fragment**:

    https://theinnersanctum.xyz/connect-league#handoff=<code>

A fragment is never sent to the server, so the code stays out of HTTP request
URLs, Netlify/CDN access logs and Referer headers. `mobile-connect.js` reads
the code and removes it with `history.replaceState` as soon as the script
evaluates — before any request — and also handles a link opened in an
already-open Link Your League tab (a fragment-only change fires `hashchange`
instead of reloading). The code is never written to `localStorage` or
`sessionStorage`.

`/connect-league?handoff=<code>` is accepted **for compatibility only** (links
created before the fragment form). It is removed the same way. Generated links
never use it, and tests assert that.
- `vendor/qrcode-generator-2.0.4.js` — pinned MIT QR library, loaded only when
  a QR code is drawn.

Desktop connection code is unchanged; see the Phase 0 suites
(`cbs-receiver-golden`, `espn-delivery-golden`, `cbs-message-listener`,
`connect-markup-baseline`, `extension-contract`, `desktop-connect-freeze`).

### Import semantics

If the device already holds the same league and team, the import uses
`LeagueConnection.update(provider, record)` (the existing flows' semantics).
Otherwise it uses `LeagueConnection.connect(provider, record)`, which adds the
league alongside. The existing flows' blanket "provider connected → update"
rule is deliberately not copied, because `update()` merges into whichever
same-provider connection is active and would overwrite a different league.

### Threat model

| Threat | Mitigation |
|---|---|
| Guessing a code | 256-bit random code; per-client failed-claim limit (20 per 10 min, keyed by a hash of the IP). |
| Leaked link reused | One-time claim (ETag-conditional tombstone, then delete); 10-minute expiry; code removed from the address bar before the claim request. |
| Code in logs / Referer | Fragment links: never part of an HTTP request URL. |
| Two phones claim at once | Only one conditional write can win; the rest get the same 410. |
| Server storage exposure | Blob key is SHA-256(code), never the code. Stored record is already sanitized. |
| Credentials in the record | Union of league-connection.js and league-snapshot.js blocked keys, plus ChatGPT/handoff keys, stripped recursively (case- and separator-insensitive) on create and again on claim. |
| ChatGPT link exposure | Not part of LeagueConnection records; also stripped; never placed in the QR/link. |
| Oracle / enumeration | Unknown, expired and used codes return an identical 410. Malformed codes are rejected before storage access. |
| Oversized/deep payloads | 750 KB body cap; nesting depth cap. |
| Cross-site abuse | POST only; non-Inner-Sanctum Origins rejected; `Cache-Control: no-store`; `Referrer-Policy: no-referrer`. |
| Markup injection in messages | Client renders server text escaped. |

**Residual risk (see "Meta Pixel" below):** any script on the page can read
`location.hash`, and the Meta Pixel runs before `mobile-connect.js` removes the
code. Because the phone claims immediately, a code observed that way is
normally already used; if the claim fails, it stays valid until it expires
(≤10 minutes).

## Phase 1B (designed, not implemented): read-only continuous sync

Goal: after the computer re-syncs CBS/ESPN, the phone gets the refreshed league
without another QR scan.

Design:

1. On "Send to my phone", the server creates a **sync pair** in addition to the
   one-time handoff: a write token (kept by the computer) and a read token
   (delivered to the phone inside the one-time claim response). Both are
   256-bit random; the store key is SHA-256(read token), and the entry records
   SHA-256(write token). Neither is the ChatGPT `linkToken`.
2. The computer listens for `innerSanctum:leagueContextChanged` (already emitted
   by `league-connection.js` on every connect/update) and posts the new
   sanitized record with its write token (`action: "sync-update"`).
3. The phone polls on page load / focus with its read token
   (`action: "sync-read"`) and applies newer records through the same import
   path. The read token cannot update or delete.
4. Revocation: `sync-revoke` with either token deletes the pair; a "Stop sending
   updates to my phone" control on the computer, "Remove from this device" on
   the phone. Tokens expire after inactivity (e.g. 30 days).
5. Threats added: a stolen read token exposes the league snapshot (no
   credentials) until revoked or expired; a stolen write token lets someone
   replace the phone's view of the league (mitigated: same validation and
   stripping as handoff; update rate limits).

Deferred because it adds long-lived bearer tokens on the phone, a new server
data lifecycle and revocation UI — materially more scope and risk than the
one-time handoff. Yahoo OAuth, when available, connects phones directly and may
reduce the need for it.

## Adding a provider (e.g. Yahoo)

Yahoo's OAuth connection will normalize into `LeagueConnection` on the phone
directly (no handoff needed). To also allow sending a Yahoo league between
devices, add `"yahoo"` to `HANDOFF_PROVIDERS` in both
`connection-handoff.js` and `mobile-connect.js`. The mobile panel, import path
and server are otherwise provider-neutral. No write permissions are assumed.

## Meta Pixel

`connect-league.html` loads the Meta Pixel in `<head>` and tracks PageView
before `mobile-connect.js` (end of `<body>`) runs.

- **Addressed:** handoff links use `#handoff=` rather than `?handoff=`, so the
  code is not in the HTTP request URL, server/access logs or Referer headers.
- **Not verified:** whether the pixel's own reported page URL includes the
  fragment. Assume it may.
- **Remaining (defense in depth, later):** scripts on the same page can
  technically read fragments. Excluding `/connect-league` from analytics, or
  removing the code in a small inline script placed before the pixel, would
  close that gap completely. The pixel is intentionally unchanged in this
  change.
