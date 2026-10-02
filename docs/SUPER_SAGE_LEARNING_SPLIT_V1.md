# Super SAGE Historical Lab — Experimental Split

The first validated corpus covers 2019 through 2026 Week 3.

Learning split:
- 2019-2022: discovery
- 2023: validation
- 2024-2025: untouched holdout
- 2026 Weeks 1-3: prospective/current test

The split is chronological by design. SAGE may generate and tune hypotheses on discovery, but may not inspect holdout outcomes to choose them.

Fantasy baseline is QB/RB/WR/TE/K player-weeks. Team defense requires a separate team-level outcome table and is not inferred from defensive-player rows.

Outcome columns (including fantasy_std, fantasy_half_ppr, fantasy_ppr and same-week final box-score statistics) are prohibited as pre-decision features during historical replay.
