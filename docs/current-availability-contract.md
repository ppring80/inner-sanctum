# Private current-availability contract

This contract separates present reserve evidence from a reconstructed transaction history. It is not wired to production, does not write the transaction cache, and does not modify rankings or customer responses.

An explicit official-club IR/PUP/NFI roster observation can establish reserve status even when the placement date is unknown. `observedAt` is the roster collection time; `placementDate` remains null. A designated-return section corroborates a known reserve classification but cannot establish IR versus PUP versus NFI by itself. An active roster listing never clears a dated reserve record. An explicit dated departure controls membership while a contradictory active listing is retained as a roster discrepancy. An explicit reserve exit confirms an exit, not health.

Contradictions retain `lastVerifiedStatus` and provenance while setting availability to unresolved. Missing players do not imply activation or departure. Wrong-season, future, unverified-identity or unapproved-source events fail the collection contract. Empty, future or stale roster observations and unsupported reserve sections cannot pass coverage. The observation age limit is configurable, with a two-hour private default.

Collection health, discovery coverage, and history completeness are independent. Discovery must be qualified by the caller; fetching a roster or verifying article dates alone is insufficient. Per-player eligibility is computed only after that requirement, source validation and conflict checks pass. The returned `productionEnabled` is always false in this private qualification module.

## Integration still required

The background collection path now uses a separate `official-club-availability` store, immutable attempt records, an independent conditional lease and bounded requests. Qualified team results can replace their own prior result; failed teams retain their last success. The public status endpoint reports this coverage independently of the NFL transaction cache. A failure reading this optional store does not change weekly readiness.

The worker is default-off through `OFFICIAL_CLUB_COLLECTION_ENABLED` and requires the existing refresh or workflow authorization. It has no schedule and has not been deployed or invoked. The bundled roster adapters remain observation-only and explicitly fail discovery qualification. Complete bounded announcement discovery, typed events and recurring overlap checks must be integrated before a team can pass coverage. Customer readers must understand the new record contract before activation; customer reads remain disabled. No private eligibility flag authorizes customer rollout.

## Qualification

The focused tests cover observed reserve status without a date, stale active listings, explicit activations, reserve conflicts, historical immutability, stale and partial collections, wrong-season and future events, provenance, unspecified return-process status, roster absence and unsupported reserve sections. The Eagles saved-source replay records Wilson as observed IR with no placement date, while keeping customer eligibility false because operational discovery integration is unfinished.

The Saints discovery and alert-lead extractor are now connected to the operational adapter. The integrated saved-page replay reads 82 sources and extracts 12 events, but fails discovery coverage because two ordinary news articles contain unsupported reserve-action wording. Inspection distinguishes an existing Etienne reference from additional departure reporting. Those claims must be reconciled without using article publication as an invented transaction date. The other 31 operational adapters remain observation-only.

An explicit verified dated departure controls membership when an active roster listing contradicts it. Both provenances and the roster discrepancy are retained; the roster observation time does not establish its publication/update time. This rule does not clear reserve restrictions, infer health, resolve same-day contradictions, or authorize customer rollout. Saints saved-page replay now passes coverage under this rule; other teams and production activation remain unqualified.

The Chargers full-news discovery and Communications lead extractor are connected to the operational adapter. Cross-day article modification blocks event-date assignment; modified articles remain inspected even when their original publication precedes the overlap window. No Chargers coverage pass is claimed: effective dates, retrospective references and roster conflicts remain to be reconciled. The other 30 adapters remain observation-only.

Chargers coverage now passes a replay of 83 freshly collected official sources: dated table corroboration resolves cross-day modified announcements, dated recap references create no events, and conditional/general return eligibility statements never create placements or activations. The fresh roster agrees with the extracted reserve changes. This is Chargers-only bootstrap qualification; recurring live overlap and league-wide qualification remain outstanding.

Dallas operational discovery now follows its qualified five-page lazy-load contract, requires chronology and an overlap anchor on recurring runs, and retains monthly update entries with their own embedded dates. Explicit reserve claims and dated update claims block coverage until extraction is qualified. No Dallas coverage pass or production activation is claimed.

Dallas unmatched-name handling follows the original collection contract: the exact Jalen Williams recap is quarantined with no status or alias, only when its known co-subject is independently verified and Williams is absent from the official roster. Quarantined claims remain visible in per-team status. Same-day/known-player conflicts still block qualification. The original verified August 30 Liufau/Moore row supplies historical reserve type without a new placement date, and qualified team event history is retained across subsequent overlap windows. Dallas saved-source replay passes with these inputs; no production activation is claimed.

Eagles operational collection is connected and passes an 83-source saved replay. Known IR recaps are bound to dated official table events; explicit opponent context never becomes an Eagles event. Historical names absent from the official roster are retained without promotion; mixed or ambiguous known-player claims still block. All four control clubs have bootstrap replay passes. The other 28 adapters, live recurring qualification, league-wide coverage, customer reader integration and production activation remain outstanding.

The remaining-club source-format audit now includes archive canonicalization. Tennessee uses its verified www host while its former non-www provenance remains accepted. A shared card parser validates exact observed module and card contracts, preserves featured prefixes, and rejects source/position/order changes. Eight remaining clubs have card-parsing candidate profiles; these are not enabled adapters and do not imply date, extraction, recurring, or coverage qualification. Redirect chains and unsupported featured layouts remain explicit gaps.

## Approved narrower reserve fallback

Customer scope is now per-player reserve safety: preserve IR/PUP/NFI restrictions, require explicit verified exits, and apply departures only to the departed team. A gap elsewhere does not invalidate a supported player decision. No statistical reliability percentage is claimed. League-wide discovery completeness remains reported separately and is never fabricated.

The collector reads all official roster pages first within the existing 360-request and 12-minute bounds. Fully parsed observations have an independent checkpoint; incomplete announcement discovery does not overwrite qualified history. Cached roster reuse retains its original observation timestamp. Layout failures preserve prior evidence.

The weekly-rankings reader is connected behind both default-off collection and customer-read flags. It uses current-week evidence only, preserves unknown placement dates, prevents same-day or older exits from clearing newer reserve evidence, leaves separate OUT reports intact, and passes explicit exits to downstream in-memory backfield reads without writing the NFL cache or frozen reviews. A stale or contradictory observation cannot establish activation. This code has not been deployed or enabled in production.
