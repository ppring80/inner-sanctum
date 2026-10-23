# Verified role-event ingestion

## Bounded collection and honest coverage

A dedicated role collector supplements the established Newswire, official club,
NFL and registered-reporter sources. It runs through the existing signed weekly
background recovery worker, deduplicates successful collection for six hours,
and uses the shared lease, thirty-minute retry and eight-attempt daily ceiling.
It makes no Tank01 or model calls and does not change either provider's budget.

Discovery reads the NFL reporting index, all 32 official club news indexes and
registered reporter indexes. Up to 32 articles are read, round-robin by publisher:
currently at most 66 public HTTP reads with concurrency four, ten-second request
bounds and four-megabyte response limits. Redirects are rejected. Fantasy guides
cannot consume these article slots or displace existing Newswire injury reads.
Existing Newswire collection, editorial records and analysis remain in place.

Coverage is **PARTIAL_VERIFIED_ROLE_REPORTS**, never all-source coverage. Every
publisher's candidate count, HTTP/metadata failures and the number omitted by the
article limit are recorded. A publisher returning no candidates is visible and
is not proof that it had no relevant news. An inaccessible/paywalled article
cannot supply evidence; registered reporters still require verified editorial
records when their public article cannot be fetched. No access-control bypass.

The collector requires fresh cached player identities before source fanout. A
total source outage preserves the last successful collection and evidence. Its
optional job reports degradation separately and cannot make core rankings
unavailable or block subsequent Newswire recovery. A failed Newswire model call
cannot starve this deterministic collection.

## Evidence admission

The shared adapter accepts one self-identified `NewsArticle` or `Article`, on an
approved publisher URL, with plain article text and verified publication/version
chronology. Registered reporters must match the source registry's actual author.
All supported teams and QB/RB/WR/TE use the same identity and assertion rules.

Assertions are examined across the article rather than only its lead. Sentence
boundaries preserve player initials. Explicit starter gains/losses, first starts
and confirmations require a unique current identity and team/position agreement.
Opponents in a sentence do not invalidate the subject's verified team. Committee
reports can produce **ROLE_REASSESSMENT**, which cannot establish a starter,
workload growth, game clearance or a lineup upgrade. Practice windows and roster
elevations do not establish starts. Forecasts, conditions, negation, long or
unsupported role assertions remain unresolved, with source text and reason in a
bounded, deduplicated review queue. Verified current unresolved role assertions
also reach the existing customer REASSESS path; they cannot silently preserve
a confident incumbent baseline. Future-week assertions stay out of the current
week. Corrected/withdrawn queue items stop creating current uncertainty. The
adapter does not guess a starter.

The adapter does not claim universal natural-language coverage. Unsupported
formats/wording and unread articles remain explicit limits. Source text and
editorial verification remain available; deterministic extraction does not
replace reporter access or editorial judgment.

Publication and modification timestamps are retained separately. Different valid
timestamps no longer cause blanket rejection. A recent modification never makes
an old publication current: publication must still be within seven days. For a
new automatic event, `effectiveAt` is the conservative source-version reporting
bound (`effectiveAtBasis: REPORT_VERSION_BOUND`, `dateBasis: PUBLISHED`), **not**
the actual role-change time (`actualEffectiveAt: null`). It cannot backdate a
change, manufacture a first affected game or qualify games before that bound.
Same-day game exclusion remains intact. Curated effective dates are unchanged.

## Persistence and customer safeguards

`sage-role-events/season:<season>` retains version-one history and curated seeds.
Conditional writes merge concurrent refreshes with three bounded attempts.
Re-reading an announcement never renews its verification. A newer independent
confirmation can corroborate an existing gain without changing its original
effective date, but cannot invent a gain, reverse a later loss or override a
conflict. Changed valid source text can withdraw previous assertions, including
when its publication is now old. Stale evidence remains visible for reassessment.

Newswire and dedicated collection metadata are separate, so a Newswire refresh
cannot overwrite dedicated collector health. Rankings expose both, plus the
unresolved-report count. Neither a source-read failure nor a summary failure
erases retained role history. Review items retain source URL, publication date,
player and reason in storage; they produce reassessment rather than confident starter claims.

Ranking scores/order, tier and cross-position rules, availability, raw-outcome
cutoffs, two-game qualification, limited sample, Moderate ceiling, preservation
of Limited confidence, customer caveats, unrelated uncertainty, Rookie contracts,
consent and paid-call budgets remain unchanged. The only role-qualification enum
addition is REASSESSMENT; it fails the existing starter-establishment gate.

## Acceptance evidence

Tests include provenance-labelled real-source excerpts from the October 2026
coverage audit, exercised both at controlled source-time and the current audit
time. These are **not historical production packet replays**. Full public HTML
snapshots were separately replayed locally without committing article bodies.
The cases cover Giants/NFL McCarthy starter reports, old Buccaneers/NFL Daniels
reports, a Buccaneers committee and Seahawks practice/Eagles elevation controls.
Current-time stale checks cannot substitute for source-time negative controls.
Bernard's curated report remains covered separately; its worker HTTP 403 is a
transport limitation, not an automatic-ingestion pass.

Deployment, scheduled collection and frozen customer-decision validation must be
reported separately. Unit tests and Bernard starting over Higbee alone do not
prove automatic coverage or exercise the exact two-game path.
