# SAGE production publication checkpoint

Keep Netlify automatic publishing locked. A successful preview build is not a production release.

Before manual publication:

1. Verify the approved release SHA, green GitHub regression check, and a READY rollback deployment.
2. Select a Netlify build whose context is `production`, branch is `main`, and full commit SHA matches the approved release. Do not publish a deploy-preview or branch-deploy build, even when its source tree matches main: runtime environment configuration differs by context.
3. Confirm the production Functions configuration contains `TANK01_API_KEY` and either that existing signing fallback or `TANK01_REFRESH_TOKEN`. Check names, scope and presence only; never copy or print values. Do not widen preview secret access.
4. Publish that exact production build, retain the lock, and verify the published deployment ID, full SHA and context again.

After publication, use the existing read-only checks:

- Weekly SAGE status: required evidence and all six positional caches must be ready. Preserve separate supplementary degradation.
- Weekly Tools Production Health: existing availability, projection, identity and customer evidence assertions must pass; do not skip a failed assertion to release.
- Injury Evidence Health: its authenticated diagnostic now reports production context and recovery/provider configuration booleans, plus availability and projection readiness. It performs no provider work or recovery dispatch. A failed result requires investigation, not counter resets.
- OAuth discovery, unauthenticated MCP rejection, representative rankings/profile/comparison/lineup behavior and unchanged decision records.

The current-week evidence guard intentionally returns a clear temporary-unavailability error when required projections or availability expire. It does not replace missing evidence with a trusted START/FLEX board. Historical records remain readable.

Conditional injury presentation is a disclosure, not a numerical injury penalty or proof that provider forecasts account for missed-game probability. Large ranking disagreements require evidence review using the same week and scoring; competitor ranks are not replacement inputs.
