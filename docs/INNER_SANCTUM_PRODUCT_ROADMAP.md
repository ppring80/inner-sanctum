# Inner Sanctum Product Roadmap

**Purpose:** Central source of truth for product priorities, production issues, SAGE evolution, connections, in-season tools, customer experience, validation, marketing, and future discoveries.

**Operating principle:** Prioritize work using **customer value + production urgency + seasonal timing + lift + dependencies**.

**Last updated:** 2026-09-09

## Roadmap Scoring

- **Priority:** P0 = urgent/blocker; P1 = high priority; P2 = important/planned; P3 = discovery/future.
- **Customer Value:** Very High / High / Medium / Low.
- **Lift:** XS < 0.5 day; S = 0.5–1 day; M = 1–3 days; L = 3–7 days; XL = 1–2+ weeks. Estimates are directional until implementation review.
- **Status:** Production / In Progress / Planned / Discovery / Blocked External / Validation.

---

# 1. Production & Reliability

## PROD-001 — Draft Repair Mode
- **Priority:** P0
- **Customer Value:** Very High
- **Lift:** M
- **Status:** Planned
- **Problem:** During a live draft, an incorrect player/team assignment or missed pick may not be discovered until several picks later. Undo Last Pick cannot repair older history without destroying subsequent correct picks. In live testing, restarting the draft was the practical recovery path.
- **Goal:** Allow any historical draft selection to be corrected non-destructively while preserving all subsequent picks.
- **Required capabilities:** change player/team; insert missing pick; delete duplicate/incorrect pick; swap/correct picks; recompute rosters, availability, positional counts, current pick/team, needs, and SAGE recommendations.
- **Target UX:** `Fix Draft → select bad pick → correct → Continue Draft`.
- **Acceptance test:** With picks 1–112 entered and pick 106 assigned to the wrong team, correcting #106 leaves picks 107–112 unchanged, updates affected rosters/player availability/position counts, recalculates SAGE, and resumes at pick 113.
- **Decision history:** Elevated to P0 after a real live-draft incident affected more than one participant and errors were discovered 5+ picks later.

## PROD-002 — Draft Sequence Mismatch Detection
- **Priority:** P0
- **Customer Value:** High
- **Lift:** S–M
- **Status:** Planned
- **Goal:** Warn when recorded pick/team appears inconsistent with expected snake-draft sequence without blocking the user.
- **Example:** `Possible draft mismatch — This pick doesn’t match the expected draft sequence. Continue · Review Draft.`
- **Dependency:** Complements PROD-001.

## PROD-003 — Round-14 Trash Lord Boundary Bug
- **Priority:** P1
- **Customer Value:** Medium
- **Lift:** XS–S
- **Status:** Planned
- **Problem:** A kicker selected at pick #168 in a 12-team, 14-round draft incorrectly triggered a warning stating the kicker was drafted before Round 14.
- **Acceptance test:** 12 teams × 14 rounds; kicker at pick 168 / Round 14 Pick 12 → no early-kicker warning.

---

# 2. Connections & Onboarding

**Product objective:** Connecting an existing fantasy league to Inner Sanctum should feel effortless regardless of provider or device.

## CONN-001 — Yahoo Fantasy API Provisioning
- **Priority:** P0
- **Customer Value:** Very High
- **Lift:** External dependency
- **Status:** Blocked External
- **Current state:** Yahoo indicated Fantasy Sports API permission was enabled, but the existing Inner Sanctum developer application still showed a blank API Permissions section.
- **Verified developer identity:** The Inner Sanctum app is owned by the Yahoo Developer identity `patpringle20` / `patpringle20@yahoo.com`.
- **Likely issue:** Earlier correspondence supplied a different login email, creating a possible entitlement/provisioning identity mismatch.
- **Next action:** Yahoo must verify Fantasy Sports permission is provisioned specifically to the developer identity that owns The Inner Sanctum application.
- **Security note:** A Client Secret was exposed during troubleshooting. Do not reproduce/store it in roadmap or communications. Rotate/revoke after access diagnosis and update production secrets securely. Yahoo requested Client ID and App ID, not Client Secret.

## CONN-002 — Yahoo Production OAuth Integration
- **Priority:** P0
- **Customer Value:** Very High
- **Lift:** M
- **Status:** Blocked by CONN-001
- **Goal:** Complete end-to-end Yahoo authentication, league discovery, selection, and sync after entitlement is available.

## CONN-003 — Universal Low-Friction League Connection
- **Priority:** P0/P1
- **Customer Value:** Very High
- **Lift:** M–L
- **Status:** Planned
- **Goal:** `Connect provider → authenticate → discover leagues → select league → connected`.
- **Hard requirement:** No customer-facing JavaScript, bookmark manipulation, address-bar tricks, repeated bookmark execution, or developer-like setup.
- **Mobile history:** Desktop-oriented CBS connection methods created unacceptable friction on phones. Mobile attempts involving bookmarks/JavaScript, CBS sign-in, league navigation, returning to Inner Sanctum, and repeated actions were rejected as an unacceptable customer experience. Android/Chrome introduced additional bookmark/search friction.
- **Success criterion:** Simple, understandable connection on desktop, iPhone/iPad, and Android.

## CONN-004 — Connection Health / Error / Recovery UX
- **Priority:** P1
- **Customer Value:** High
- **Lift:** M
- **Status:** Planned
- **Goal:** Clearly show connection state, last sync, failures, recovery actions, and provider-specific guidance without technical jargon.

## CONN-005 — CBS Connection & Sync
- **Priority:** P1
- **Customer Value:** High
- **Status:** Working; simplification remains
- **History:** CBS fantasy-football league sync is functional. Remaining focus is connection simplification and mobile-friendly onboarding.

## CONN-006 — ESPN Connection
- **Priority:** P1
- **Customer Value:** High
- **Status:** Existing capability / continue hardening
- **History:** ESPN connection is currently used by Inner Sanctum auction draft tooling.

---

# 3. In-Season Tools

**Priority:** HIGH. Draft-season acquisition must transition into sustained weekly value: **Help me win this week.**

## SEASON-001 — In-Season Readiness Review
- **Priority:** P0/P1
- **Customer Value:** Very High
- **Lift:** M
- **Status:** Planned
- **Goal:** Audit all current in-season functionality for production readiness, gaps, UX friction, data dependencies, and highest-value/lowest-lift improvements.

## SEASON-002 — Weekly Rankings
- **Priority:** P1
- **Customer Value:** Very High
- **Status:** Existing capability / evolve
- **Goal:** Scoring-aware, contextual weekly rankings with clear SAGE verdicts and actionable explanations.

## SEASON-003 — Start/Sit Intelligence
- **Priority:** P1
- **Customer Value:** Very High
- **Status:** Planned/Evolve
- **Goal:** Compare actual roster options and recommend the lineup decision that maximizes expected weekly value, with clear reasons and risks.

## SEASON-004 — Waiver / Free-Agent Intelligence
- **Priority:** P1
- **Customer Value:** Very High
- **Status:** Planned/Evolve
- **Goal:** Identify additions based on the user's roster, league configuration, expected role/value, opportunity cost, and likely lineup impact rather than generic waiver rankings.

## SEASON-005 — Roster Optimization
- **Priority:** P1
- **Customer Value:** Very High
- **Status:** Planned/Evolve
- **Goal:** Optimize the actual weekly starting lineup using league rules, FLEX eligibility, projections, matchup/context, and risk.

## SEASON-006 — Injury / Availability / Context Intelligence
- **Priority:** P1
- **Customer Value:** High
- **Status:** Planned/Evolve
- **Goal:** Surface actionable injury/game context and avoid treating anomalous player data as model failure before verifying actual game/injury context.

---

# 4. SAGE Evolution

**Core question:** Of the players available right now, who adds the most value to THIS roster in THIS league at THIS point in the draft?

**Decision sequence:** `Can this player start? → Would this player improve my likely starting lineup? → Is that improvement greater than the alternatives?`

## SAGE-001 — League Configuration Intelligence
- **Priority:** P0
- **Customer Value:** Very High
- **Lift:** S
- **Estimate:** 0.5–1 day
- **Goal:** Understand actual QB/RB/WR/TE/FLEX/Superflex/etc. starting slots and evaluate recommendations under those rules.

## SAGE-002 — FLEX Eligibility Intelligence
- **Priority:** P0
- **Customer Value:** Very High
- **Lift:** S
- **Estimate:** 0.5–1 day
- **Goal:** Recognize that duplicate positions can still add starting-lineup value when eligible for FLEX.

## SAGE-003 — Incremental Starting-Lineup Value
- **Priority:** P0
- **Customer Value:** Very High
- **Lift:** M
- **Estimate:** 1–3 days
- **Goal:** Calculate how much each available candidate improves the user's optimal starting lineup rather than relying primarily on standalone player rank.

## SAGE-004 — Roster-Aware Recommendations
- **Priority:** P0
- **Customer Value:** Very High
- **Lift:** M
- **Estimate:** 1–2 days
- **Goal:** Incorporate roster construction, positional need, likely starting role, lineup flexibility, draft stage, and available alternatives.
- **Rule:** Do not use a blanket duplicate-position penalty.

## SAGE-005 — Counterintuitive Recommendation Explanations
- **Priority:** P0
- **Customer Value:** Very High
- **Lift:** S–M
- **Estimate:** 1–2 days
- **Goal:** Explicitly explain why a seemingly redundant player improves the lineup.
- **Example:** `TAKE NOW — projects as a better FLEX starter than your current alternatives despite TE already being filled.`
- **Learning:** A recommendation can be correct while its explanation is inadequate.

## SAGE-006 — Recommendation Diversity
- **Priority:** P1
- **Customer Value:** High
- **Lift:** M
- **Estimate:** 1–2 days
- **Goal:** Surface several viable alternatives across positions instead of clustering recommendations at one position.

## SAGE-007 — Positional Scarcity
- **Priority:** P1
- **Customer Value:** High
- **Lift:** M–L
- **Estimate:** 2–4 days
- **Goal:** Measure the opportunity cost of waiting at each position.

## SAGE-008 — SAGE Tiers
- **Priority:** P1
- **Customer Value:** High
- **Lift:** S–M
- **Estimate:** 1–2 days
- **Goal:** Communicate meaningful value bands rather than false precision between adjacent ranks.

## SAGE-009 — SAGE vs Market
- **Priority:** P1
- **Customer Value:** High
- **Lift:** S–M
- **Estimate:** 1–2 days assuming ADP/ECR inputs exist
- **Goal:** Identify market undervaluation/overvaluation using SAGE rank/value versus ADP/ECR.

## SAGE-010 — Upside / Risk / Bust Indicators
- **Priority:** P1
- **Customer Value:** High
- **Lift:** M–L
- **Estimate:** 2–4 days
- **Goal:** Provide defensible quick-read upside and downside indicators.

## SAGE-011 — SOS Intelligence
- **Priority:** P1
- **Customer Value:** Medium/High
- **Lift:** S
- **Estimate:** <1 day if existing schedule/context data can be reused
- **Goal:** Incorporate strength of schedule where decision-relevant.

## SAGE-012 — Draft-Stage Intelligence
- **Priority:** P1
- **Customer Value:** High
- **Lift:** M
- **Goal:** Change recommendation priorities as roster construction and remaining rounds evolve.

## SAGE-013 — Lineup Optionality
- **Priority:** P1
- **Customer Value:** High
- **Lift:** M
- **Goal:** Value players who create multiple strong lineup configurations while balancing opportunity cost.

## SAGE-014 — Next-Pick / Wait Risk
- **Priority:** P2
- **Customer Value:** High
- **Lift:** L
- **Estimate:** 3–6 days
- **Goal:** Estimate likelihood a player remains available until the user's next selection.

## SAGE-015 — SAGE Learning Case Capture
- **Priority:** P1
- **Customer Value:** Very High
- **Lift:** M–L
- **Estimate:** 2–4 days
- **Goal:** Automatically preserve disagreements, counterintuitive recommendations, unusual decisions, and relevant decision context.
- **Capture:** league settings, roster, available players, pick/stage, projections/SAGE scores, scarcity, recommendations, explanation, user selection, and outcomes when useful.

## SAGE-016 — Decision Failure vs Explanation Failure
- **Priority:** P1/P2
- **Customer Value:** Very High
- **Lift:** L
- **Estimate:** 3–5 days
- **Goal:** Determine whether SAGE made the wrong recommendation or made the right recommendation without explaining it adequately.

## SAGE-017 — Outcome Learning
- **Priority:** P2
- **Customer Value:** Very High
- **Lift:** XL
- **Estimate:** 1–2+ weeks
- **Goal:** Evaluate recommendations against subsequent outcomes while avoiding simplistic outcome bias.

## SAGE-018 — Controlled SAGE Evolution Pipeline
- **Priority:** P2
- **Customer Value:** Very High
- **Lift:** XL
- **Estimate:** 2–4+ weeks
- **Goal:** Evidence-driven evolution, not uncontrolled self-modification.
- **Loop:** `Live decision → capture → outcome → learning case → hypothesis → backtest → historical validation → regression testing → approved promotion`.

## SAGE-019 — Historical Validation
- **Priority:** P1/P2
- **Customer Value:** Very High
- **Lift:** L–XL
- **Goal:** Test recommendation logic against historical and live draft states and retain prior-season predictions, rankings, actuals, calibration, and validation results across season rollovers.

## SAGE-020 — Post-Draft Learning Report
- **Priority:** P2
- **Customer Value:** High
- **Lift:** M–L
- **Goal:** Show where SAGE and the user agreed/disagreed and what later evidence indicates.

### Canonical Learning Case: TE2 with Two FLEX Slots
- User owns Tyler Warren at TE.
- SAGE recommends George Kittle.
- Initial reaction: TE is already filled.
- League configuration allows TE in FLEX and has two FLEX slots.
- Decision question: Does Kittle improve the optimal starting lineup more than available RB/WR/QB alternatives?
- Explanation question: If yes, did SAGE explicitly explain the FLEX upgrade?
- Product lesson: Surface non-obvious value and explain it quickly enough to be useful under the draft clock.

---

# 5. Product Experience / UX

## UX-001 — Universal Player Profile
- **Priority:** P1
- **Customer Value:** Very High
- **Lift:** M–L
- **Status:** Planned
- **Goal:** Reusable player profile opened by clicking player names across Draft Command, Weekly Rankings, and other tools.
- **V1:** identity, SAGE verdict/recommendation and reasons, scoring-aware rank/projection/value, context-specific weekly/draft info, recent trend, key risks/watch items, and concise Inner Sanctum Insight.

## UX-002 — 1/3/10-Second Decision Design
- **Priority:** Continuous principle
- **Goal:** 1 second = overall signal; 3 seconds = direction/assessment; 10 seconds = problem/action/explanation.
- **Principle:** Clear / concise / consistent. Complex fantasy analysis should become intuitive customer decisions.

## UX-003 — SAGE Decision Board
- **Priority:** P1/P2
- **Customer Value:** High
- **Lift:** M–L
- **Goal:** Compact board using tiers, rank, value, lineup impact, risk, SOS, and market comparison while adding personalized SAGE intelligence rather than copying competitor presentation.

---

# 6. Validation & Intelligence

## VAL-001 — Recommendation Decision Logging
- **Priority:** P1
- **Customer Value:** Very High
- **Lift:** M
- **Goal:** Capture enough context at recommendation time to reproduce and evaluate the decision later.

## VAL-002 — Calibration / Regression Framework
- **Priority:** P1/P2
- **Customer Value:** Very High
- **Lift:** L–XL
- **Goal:** Validate proposed SAGE changes against historical/live cases before production promotion.

## VAL-003 — Anomalous Stat Verification
- **Priority:** Continuous principle
- **Goal:** When suspicious weekly player stats appear, verify the actual NFL week/game/injury context before concluding there is a data-quality or model failure.

---

# 7. Marketing & Growth

**Operating objective:** Compete for attention without trying to outspend established fantasy platforms or requiring the founder to become a full-time marketer.

**Marketing principle:** **Low lift + low cash burn + high measurable value. Automate anything repetitive.**

**Founder-time acceptance criterion:** A week's normal marketing output should be reviewable/approvable in **≤15 minutes**, with typical individual content packages requiring approximately **1–3 minutes** to approve, revise, or kill.

## MKT-001 — Low-Touch Marketing Engine
- **Priority:** P1
- **Customer Value:** Very High
- **Lift:** L initially; very low ongoing
- **Estimate:** ~3–7 focused development days depending on video/distribution automation depth
- **Cash Cost:** Low
- **Goal:** `Product/SAGE event → identify story → create content → create assets → package → founder approval → distribute/schedule → measure`.

## MKT-002 — Automated Content Ideation & Scripts
- **Priority:** P1
- **Customer Value:** Very High
- **Lift:** S
- **Cash Cost:** Very Low
- **Goal:** Generate hooks, scripts, titles, captions, CTAs, and platform-specific variants from real Inner Sanctum intelligence.

## MKT-003 — SAGE Insight → Marketing Content
- **Priority:** P1
- **Customer Value:** Very High
- **Lift:** M
- **Cash Cost:** Very Low
- **Goal:** Allow SAGE recommendations, market disagreements, waiver calls, Start/Sit decisions, validation results, and customer wins to become candidate marketing stories.
- **Example story:** `Your TE spot is filled. Why is SAGE still telling you to draft George Kittle?`

## MKT-004 — Automated Graphics
- **Priority:** P1
- **Customer Value:** High
- **Lift:** S–M
- **Cash Cost:** Low
- **Goal:** Consistent branded graphics generated from approved content concepts.

## MKT-005 — Automated Short-Form Video
- **Priority:** P1
- **Customer Value:** Very High
- **Lift:** M
- **Cash Cost:** Low
- **Goal:** Produce 15–45 second demonstrations for Shorts/Reels/TikTok/social without requiring repeated manual production.

## MKT-006 — Founder Avatar / Digital Presenter
- **Priority:** P2
- **Customer Value:** High
- **Lift:** M
- **Cash Cost:** Low/Medium
- **Status:** Discovery
- **Goal:** Explore avatar/voice production so the founder does not need to record every video. Revalidate provider capabilities/pricing before committing.

## MKT-007 — Automated Scheduling & Distribution
- **Priority:** P1
- **Customer Value:** Very High
- **Lift:** S–M
- **Cash Cost:** Low
- **Goal:** After approval, route content into appropriate scheduling/distribution channels with minimal manual intervention.

## MKT-008 — Customer Testimonial / Proof Pipeline
- **Priority:** P1
- **Customer Value:** High
- **Lift:** S
- **Cash Cost:** Near zero
- **Goal:** Capture authentic customer reactions and convert approved proof points into reusable marketing assets.
- **Evidence:** Early live-draft users expressed strong enthusiasm; one league mate spontaneously asked about investment and offered development funding. Treat as meaningful early validation, not proof of product-market fit.

## MKT-009 — SEO / Content Reuse
- **Priority:** P1/P2
- **Customer Value:** High
- **Lift:** M
- **Cash Cost:** Very Low
- **Goal:** Reuse high-value SAGE content across search-oriented articles/pages and social channels rather than creating every asset from scratch.

## MKT-010 — Controlled Paid Experiments
- **Priority:** P2
- **Customer Value:** TBD by evidence
- **Lift:** S
- **Cash Cost:** Strictly capped experiments
- **Goal:** Prefer multiple small measurable tests over large campaign spending before acquisition economics are understood.

## MKT-011 — Marketing Analytics Feedback Loop
- **Priority:** P1
- **Customer Value:** Very High
- **Lift:** M
- **Cash Cost:** Low
- **Goal:** Track what content generates attention, activation, conversion, and retention and use evidence to improve future content selection.

### Target Approval Package
Each candidate should arrive ready for a simple decision:

`CONTENT ID → Hook → Video/Graphic → Platform copy variants → CTA → Recommended timing → APPROVE / REVISE / KILL`

### Marketing Flywheel
`Inner Sanctum generates intelligence → intelligence generates evidence/stories → automated system packages content → founder approves → distribution → performance data → better content selection`

---

# 8. Discovery / Future

Capture promising ideas here before commitment. Promote to a primary lane only after customer value, lift, timing, and dependencies are understood.

Potential areas:
- deeper personalization without reinforcing user bias
- confidence/decision-margin indicators
- what-if draft intelligence
- additional provider integrations
- mobile product expansion
- additional acquisition channels

---

# Immediate Priority Stack

1. **Production resilience:** Draft Repair Mode and mismatch protection.
2. **Connections:** Resolve Yahoo external provisioning and simplify universal desktop/mobile connection experience.
3. **In-season readiness:** Audit and prioritize weekly tools as customer value shifts from draft to season management.
4. **SAGE high-value/low-lift evolution:** league configuration + FLEX awareness + incremental lineup value + roster-aware recommendations + explanations.
5. **Marketing engine:** establish low-cost, low-founder-lift content packaging and approval workflow.
6. **Instrumentation:** begin capturing decision context now so future SAGE learning has evidence to work from.

---

# Roadmap Maintenance Rules

1. Important discoveries from live use, customer feedback, testing, or competitive research should be added here rather than left only in chat history.
2. Production incidents record **what happened, customer impact, root cause when known, and acceptance criteria**.
3. New feature ideas receive **Value, Lift, Priority, Status, Dependencies, and Decision History** before commitment.
4. SAGE changes should distinguish **recommendation quality** from **explanation quality**.
5. Controlled SAGE evolution requires evidence, backtesting, regression testing, and approval before production promotion.
6. Marketing work should favor **low lift / low cash cost / measurable customer acquisition or retention value**.
7. Historical data and validation evidence should be preserved across season rollovers whenever applicable.
8. Review priorities as seasonal urgency changes; the roadmap is living documentation, not a static wish list.
