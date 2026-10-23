# Verified role-event ingestion

Newswire's existing official NFL article reads can now produce structured role
evidence independently of the AI summary step. This adds no network requests,
Tank01 calls, model calls, refresh schedule or customer interaction.

The adapter accepts only one self-identified `NewsArticle` with an original,
unchanged publication date and a plain `articleBody`. Its declarative lead must
explicitly name the player, team and starting position using a supported
announcement form. It matches a unique current cached player identity. Headlines,
RSS descriptions, model summaries, forecasts, quotes, depth charts, teammate
injuries, co-starters and retrospective/ambiguous wording cannot establish a role.
Unsupported reports remain eligible for existing Newswire analysis and editorial
verification; this adapter does not weaken or replace those capabilities.

The event retains the exact source URL, publication timestamp, supporting sentence
and body hash. `effectiveAt` uses the source publication timestamp with
`dateBasis: PUBLISHED`; it does not invent an earlier start date or game ID. Games
on that day remain excluded unless separately verified under the existing rules.

`sage-role-events/season:<season>` retains role history across news-card expiry
and weekly rollover. Conditional writes merge concurrent refreshes with three
bounded attempts. Reading the same announcement again never renews verification.
A newer dated official lead explicitly confirming an existing starter can
corroborate that event without changing its original effective date. Confirmation
alone cannot create an event or overturn a later loss or conflicting evidence.
Withdrawn source statements remain in history but cannot clear role concerns.
Stale evidence stays visible for reassessment and cannot establish the current role.

Editorial records remain authoritative inputs. Automatic history supplements
them and deduplicates the same event ID; it does not modify the editorial registry.
Newswire summary failure cannot erase role history; role-storage failure cannot
stop the existing Newswire summary and publication flow.

Weekly rankings expose `metadata.roleIngestion` with the last collection time,
retained event count, identity freshness, accepted report count and rejection
reasons. Coverage is explicitly `PARTIAL_OFFICIAL_REPORTS`, or
`NOT_YET_OBSERVED` before collection. It is never a claim that all NFL/team/reporter
reports were discovered. The existing six-article NFL discovery bound is retained;
starter/bench/role URLs may use spare slots within that bound, without displacing
previously selected reports. All 32 teams and four
offensive positions use the same adapter, but unsupported article formats and
reports outside existing collection still require verified editorial ingestion.

No ranking values, ordering, tier rules, cross-position gates, availability rules,
budget limits, two-game qualification, sample labels, confidence caps, customer
caveats or Rookie contracts change. Production acceptance must separately report:
deployment, actual collection, and customer behavior. Source fixtures and healthy
Bernard decisions alone do not prove automatic coverage of other players.
