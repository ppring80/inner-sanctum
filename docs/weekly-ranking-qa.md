# Weekly SAGE ranking QA

Run this release gate after generating the weekly rankings and collecting at
least two independent benchmark lists for every position:

```sh
npm run qa:weekly-rankings -- path/to/week-input.json
```

The input is JSON with three top-level objects:

```json
{
  "positions": {
    "QB": [{ "name": "Example Player", "rank": 1 }],
    "RB": [], "WR": [], "TE": [], "K": [], "DEF": []
  },
  "benchmarks": {
    "QB": [
      {
        "source": "Source A",
        "scoring": "half-ppr",
        "rankings": [{ "name": "Example Player", "position": "QB", "rank": 2 }]
      },
      {
        "source": "Source B",
        "scoring": "half-ppr",
        "rankings": [{ "name": "Example Player", "position": "QB", "rank": 1 }]
      }
    ]
  },
  "availability": {
    "QB": { "exampleplayer": "QUESTIONABLE" }
  }
}
```

Provide the same structures for QB, RB, WR, TE, K, and DEF. Availability keys
are normalized player or defense names: lowercase with punctuation and spaces
removed.

The command exits nonzero when a position has fewer than two benchmark sources,
an unavailable player remains ranked, a doubtful player is in the starter range,
or a SAGE rank exceeds its allowed consensus deviation. Competitor rankings are
QA evidence only and never change a SAGE score or ranking automatically. Every
flag must be resolved or documented as an intentional SAGE exception before the
weekly release is approved.
