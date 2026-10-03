# Super SAGE Columbia Impact Graph V1

Material Change Detection decides whether SAGE should wake up.
The Impact Graph decides where the change flows.

Examples:
- OL change -> same-team QB/RB/WR/TE
- WR change -> same-team WR/QB/TE/RB opportunity context
- CB change -> opponent WR/QB matchup context
- safety change -> opponent QB/WR/TE
- edge change -> opponent QB and downstream receiving/rushing context
- RB change -> same-team RB/QB context

Propagation never assumes positive or negative effect. It schedules targeted re-analysis only.

Replacement opportunity remains a separate evidence problem; the nominal backup is not automatically awarded the missing role.
