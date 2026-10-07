# SUPER SAGE OPERATOR V1 — SYNTHETIC TRAINING FREEZE

Freeze head baseline: a37698f (full regression wall green before this documentation commit)

## What V1 has earned
- Decision Demand grammar from real fantasy-user questions.
- Presenter V1: call first, proportional explanation, countercase, confidence, flip condition.
- Customer-stated concern preservation without treating the concern as verified truth.
- Causal deduplication: multiple observations/reports from one cause count once.
- Prior discipline: reinforce, reassess, invalidate.
- Material-change handling across player, offense, opponent defense, timing and role state.
- Uncertainty taxonomy: MISSING_INFORMATION vs CLOSE_CALL vs STABLE.
- Complete-information pressure behavior: when all relevant state is known, do not hide behind UNRESOLVED.
- Evidence strength: NONE / SUPPORTING / MATERIAL / STRUCTURAL.
- Tumbler-only provisional calls with zero production authority.

## Acceptance corpus
- 50-case adversarial specification.
- 20 structured executable gauntlet cases.
- 10 raw unscripted cases.
- 4 complete-information pressure cases.
- Explicit facet inspections for causal grouping, must-win context, customer claims, late optionality, opponent/role changes, and evidence strength.

## Promotion boundary
This freeze does NOT authorize production decisions.
The unscripted Operator remains SHADOW/TUMBLER ONLY:
- canChangeProductionDecision: false
- productionAuthority: false
- providerCallsAllowed: false
- outcomeDataAllowed: false
- automaticPromotionAllowed: false

## Next phase — Sensei vs Rookie
Stop adding synthetic rules unless a real case exposes a repeatable gap.

For each real pregame decision:
1. Freeze the evidence as-of decision time. No outcome leakage.
2. Human/Sensei makes an independent call without seeing Rookie's call.
3. Rookie receives the same admissible evidence and makes a tumbler-only provisional call.
4. Compare CALL, PRIOR, MATERIAL CHANGES, EVIDENCE/CAUSAL GROUPS, STRENGTH, THRESHOLD, UNCERTAINTY, CONFIDENCE/CONDITIONS.
5. Grade reasoning separately from decision: PASS / PASS_DIFFERENT_CALL / QUESTIONABLE / FAIL.
6. Disagreement creates a Decision Lab hypothesis, not an immediate code change.
7. Repeated support + historical validation + regression + explicit promotion are required before production policy changes.
8. Turbine #6 audits postgame process separately; outcome never rewrites the pregame grade.

## First real lab
Mahomes vs Maye: use only the pregame evidence available at the original decision time. This is the case that exposed the need to model belief movement and threshold crossing rather than merely return rankings.
