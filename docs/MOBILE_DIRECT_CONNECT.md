# Mobile direct league connect

## Goal

Customers must be able to connect CBS or ESPN from a phone without requiring a nearby desktop computer.

## Guardrails

- Keep the accepted desktop CBS and ESPN connection flow unchanged.
- Keep desktop-connect-freeze and connected-stack-lock as hard regression gates.
- Keep provider authentication on provider-controlled pages.
- Return only the existing sanitized league capture to Inner Sanctum.
- Preserve the LeagueConnection contract used by SAGE and season tools.
- Existing device handoff is an optional fallback, not the primary mobile experience.
- Build and accept one provider/device path at a time.

## Acceptance order

1. CBS Android phone-only.
2. CBS iPhone/iPad phone-only.
3. ESPN Android phone-only.
4. ESPN iPhone/iPad phone-only.

## CBS Android acceptance

Starting with only an Android phone, the customer can open Inner Sanctum, choose CBS, authenticate with CBS normally, select the desired fantasy league, return the sanitized league capture to Inner Sanctum, see the connected league/team, and use the same LeagueConnection with SAGE.

The flow must not require a desktop computer, developer tools, or manual JavaScript entry.

## Architecture boundary

A normal Inner Sanctum web page cannot inspect an authenticated provider page on another origin. The mobile capture mechanism therefore has to execute in the authenticated provider-page context or use an installed mobile integration.

The existing CBS browser connector already proves the data side of this boundary. The first engineering target is reliable Android execution and return transport around that proven capture, not another CBS parser.

## Desktop regression rule

After every implementation change, the existing desktop golden, freeze, and lock tests must remain green. A proposed change to a protected desktop block is a stop-and-review event rather than an automatic freeze update.
