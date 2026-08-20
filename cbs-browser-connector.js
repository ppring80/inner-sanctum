/*
  THE INNER SANCTUM — cbs-browser-connector.js
  ------------------------------------------------
  Browser-assisted, READ-ONLY CBS Fantasy connector.

  VERSION 0.2.0

  PROVEN AGAINST A REAL CBS COMMISSIONER LEAGUE
  ------------------------------------------------
  The connector can collect:

    - league identity
    - user's fantasy team identity
    - roster
    - CBS player IDs
    - actual player positions
    - NFL teams
    - active/reserve status when available
    - full league standings
    - CBS team IDs
    - divisions
    - W/L/T
    - PF / PA
    - full team schedule
    - opponent CBS team IDs
    - home / away
    - roster limits
    - starting lineup requirements
    - scoring rules
    - scoring format
    - playoff structure
    - team matchup projections
    - player projection rows when exposed by CBS

  SECURITY BOUNDARY
  ------------------------------------------------
  This connector:

    - DOES NOT collect CBS usernames
    - DOES NOT collect CBS passwords
    - DOES NOT read cookies
    - DOES NOT return cookies
    - DOES NOT read Authorization headers
    - DOES NOT return CBS session tokens
    - DOES NOT return CBS page tokens
    - DOES NOT solve CAPTCHA
    - DOES NOT perform transactions
    - DOES NOT modify lineups
    - DOES NOT add/drop players

  It operates only in the context of a CBS Fantasy Football league
  the user has already authenticated into normally.

  The connector fetches additional pages only from the SAME CBS
  league origin using the user's already-authenticated browser
  session.

  Example:

      const raw =
        await CBSBrowserConnector.captureAll();

      const normalized =
        normalizeLeagueData("cbs", raw);

  IMPORTANT:
  capture() remains synchronous and returns the current-page roster
  snapshot for backward compatibility.

  captureAll() is the full multi-page collector.
*/

(function () {
  "use strict";

  const VERSION = "0.2.0";

  const CBS_HOST_RE =
    /^([^.]+)\.football\.cbssports\.com$/i;

  const PATHS = {
    roster: "/teams",
    standings: "/standings/overall",
    schedule: "/schedule/team",
    rules: "/rules",
    preview: "/scoring/preview",
  };

  /*
    ------------------------------------------------
    GENERIC HELPERS
    ------------------------------------------------
  */

  function clean(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function numberOrNull(value) {
    const text = clean(value);

    if (!text || text === "-") {
      return null;
    }

    const n = Number(
      text.replace(/,/g, "")
    );

    return Number.isFinite(n)
      ? n
      : null;
  }

  function integerOrNull(value) {
    const n = numberOrNull(value);

    return Number.isInteger(n)
      ? n
      : null;
  }

  function parseTeamIdFromHref(href) {
    if (!href) return null;

    const match =
      String(href).match(
        /\/teams\/(\d+)(?:[/?#]|$)/i
      );

    return match
      ? match[1]
      : null;
  }

  function isCbsFantasyPage() {
    return CBS_HOST_RE.test(
      location.hostname
    );
  }

  function assertCbsFantasyPage() {
    if (!isCbsFantasyPage()) {
      throw new Error(
        "CBSBrowserConnector must run inside an authenticated CBS Fantasy Football league."
      );
    }
  }

  function getLeagueId() {
    const match =
      location.hostname.match(
        CBS_HOST_RE
      );

    return match
      ? match[1]
      : "";
  }

  function getSeasonFromDocument(doc) {
    /*
      First try obvious year controls.
    */

    const selects =
      [...doc.querySelectorAll("select")];

    for (const select of selects) {
      const selected =
        clean(
          select.selectedOptions?.[0]
            ?.textContent
        );

      if (/^20\d{2}$/.test(selected)) {
        return Number(selected);
      }
    }

    /*
      CBS sometimes initializes the fantasy year in
      page script text.
    */

    for (const script of doc.scripts) {
      const text =
        script.textContent || "";

      const match =
        text.match(
          /FantasyGlobalChatJson\.year\s*=\s*(\d{4})/
        );

      if (match) {
        return Number(match[1]);
      }
    }

    /*
      Live-page global fallback.
    */

    if (doc === document) {
      try {
        const year =
          Number(
            window.FantasyGlobalChatJson
              ?.year
          );

        if (
          Number.isInteger(year) &&
          year > 2000 &&
          year < 2100
        ) {
          return year;
        }
      } catch (e) {
        // Ignore.
      }
    }

    return new Date().getFullYear();
  }

  function getLeagueNameFromDocument(doc) {
    const selectors = [
      ".team-info-name-league",
      ".nav-my-teams-league",
    ];

    for (const selector of selectors) {
      const value =
        clean(
          doc.querySelector(selector)
            ?.textContent
        );

      if (value) {
        return value;
      }
    }

    /*
      Rules page fallback.
    */

    for (const row of doc.querySelectorAll("tr")) {
      const cells =
        [...row.querySelectorAll("th,td")]
          .map(function (cell) {
            return clean(
              cell.textContent
            );
          });

      if (
        clean(cells[0])
          .toLowerCase() ===
        "league name"
      ) {
        return clean(cells[1]);
      }
    }

    return "";
  }

  function getTeamNameFromDocument(doc) {
    const selectors = [
      ".team-info-name-owner",
      ".nav-my-teams-name",
    ];

    for (const selector of selectors) {
      const value =
        clean(
          doc.querySelector(selector)
            ?.textContent
        );

      if (value) {
        return value;
      }
    }

    /*
      Common CBS team header:
        The Vanilla Gorilla (0-0-0)
    */

    const bodyText =
      clean(doc.body?.textContent);

    const match =
      bodyText.match(
        /([A-Za-z0-9'&.\- ]+)\s+\(\d+-\d+-\d+\)/
      );

    return match
      ? clean(match[1])
      : "";
  }

  function getTeamIdFromLivePage() {
    const inputValue =
      document.querySelector(
        'input[name="team"]'
      )?.value;

    if (inputValue) {
      return clean(inputValue);
    }

    try {
      const id =
        window.FantasyGlobalChatJson
          ?.userAuth
          ?.attrib
          ?.team
          ?.id;

      if (id !== undefined &&
          id !== null) {
        return clean(id);
      }
    } catch (e) {
      // Ignore.
    }

    return null;
  }

  function parseHtml(html) {
    return new DOMParser()
      .parseFromString(
        html,
        "text/html"
      );
  }

  async function fetchLeagueDocument(path) {
    assertCbsFantasyPage();

    const url =
      new URL(
        path,
        location.origin
      );

    /*
      Never allow the collector to leave the user's
      current authenticated CBS league origin.
    */

    if (
      url.origin !==
      location.origin
    ) {
      throw new Error(
        "CBS connector refused a cross-origin request."
      );
    }

    const response =
      await fetch(url.href, {
        method: "GET",

        /*
          Same-origin browser authentication only.
          No cookie values are inspected or returned.
        */
        credentials: "same-origin",

        cache: "no-store",

        headers: {
          Accept: "text/html",
        },
      });

    if (!response.ok) {
      throw new Error(
        "CBS returned " +
        response.status +
        " for " +
        path
      );
    }

    const html =
      await response.text();

    return {
      url: url.href,
      html,
      doc: parseHtml(html),
    };
  }

  /*
    ------------------------------------------------
    ROSTER COLLECTOR
    ------------------------------------------------
  */

  function getRosterMap() {
    try {
      return (
        window.lineupBuilder
          ?.rosterMap
          ?.slot || {}
      );
    } catch (e) {
      return {};
    }
  }

  function findRosterMapPlayer(
    rosterMap,
    row,
    cbsPlayerId
  ) {
    if (
      row?.id &&
      rosterMap[row.id]
    ) {
      const candidate =
        rosterMap[row.id];

      if (
        String(
          candidate?.id ?? ""
        ) ===
        String(cbsPlayerId)
      ) {
        return candidate;
      }
    }

    return (
      Object.values(rosterMap)
        .find(function (player) {
          return (
            String(
              player?.id ?? ""
            ) ===
            String(cbsPlayerId)
          );
        }) || {}
    );
  }

  function getActualPosition(
    row,
    playerData
  ) {
    /*
      Prefer CBS player eligibility over lineup slot.

      Example:
        playerData.pos could be RB-WR-TE
        while elig.currPos is RB.
    */

    const eligible =
      clean(
        playerData
          ?.elig
          ?.currPos
      );

    if (
      eligible &&
      !eligible.includes("-")
    ) {
      return eligible;
    }

    const metadata =
      clean(
        row.querySelector(
          ".playerPositionAndTeam"
        )?.textContent
      );

    if (metadata) {
      const parts =
        metadata
          .split(/[•·]/)
          .map(clean)
          .filter(Boolean);

      if (parts[0]) {
        return parts[0];
      }
    }

    const tablePosition =
      clean(
        row.querySelector(
          ".playerPosition"
        )?.textContent
      );

    if (
      tablePosition &&
      !tablePosition.includes("-")
    ) {
      return tablePosition;
    }

    return clean(
      playerData?.pos
    );
  }

  function getNflTeam(
    row,
    playerData
  ) {
    const structured =
      clean(playerData?.team);

    if (structured) {
      return structured;
    }

    const metadata =
      clean(
        row.querySelector(
          ".playerPositionAndTeam"
        )?.textContent
      );

    if (!metadata) {
      return "";
    }

    const parts =
      metadata
        .split(/[•·]/)
        .map(clean)
        .filter(Boolean);

    return parts.length > 1
      ? parts[1]
      : "";
  }

  function extractRosterFromDocument(
    doc,
    useLiveRosterMap
  ) {
    const rosterMap =
      useLiveRosterMap
        ? getRosterMap()
        : {};

    const roster = [];

    const seen =
      new Set();

    doc.querySelectorAll(
      "tr.playerRow"
    ).forEach(function (row) {
      const link =
        row.querySelector(
          'a.playerLink[href*="/players/playerpage/"]'
        );

      if (!link) {
        return;
      }

      const idMatch =
        link.href.match(
          /\/players\/playerpage\/(\d+)/
        );

      const cbsPlayerId =
        idMatch?.[1];

      if (
        !cbsPlayerId ||
        seen.has(cbsPlayerId)
      ) {
        return;
      }

      seen.add(cbsPlayerId);

      const playerData =
        findRosterMapPlayer(
          rosterMap,
          row,
          cbsPlayerId
        );

      const name =
        clean(
          playerData?.fullName
        ) ||
        clean(
          link.textContent
        );

      if (!name) {
        return;
      }

      roster.push({
        cbsPlayerId,

        name,

        position:
          getActualPosition(
            row,
            playerData
          ),

        nflTeam:
          getNflTeam(
            row,
            playerData
          ),

        status:
          clean(
            playerData?.status
          ) || null,

        projectedPoints: 0,
      });
    });

    return roster;
  }

  function captureCurrentRoster() {
    assertCbsFantasyPage();

    const roster =
      extractRosterFromDocument(
        document,
        true
      );

    if (!roster.length) {
      throw new Error(
        "No CBS roster players were found on this page. Open the CBS My Team / roster page before running the basic capture."
      );
    }

    return roster;
  }

  /*
    ------------------------------------------------
    STANDINGS COLLECTOR
    ------------------------------------------------
  */

  function captureStandingsFromDocument(
    doc
  ) {
    const standings = [];

    let currentDivision = "";

    let headers = [];

    doc.querySelectorAll("tr")
      .forEach(function (row) {
        const rawCells =
          [...row.querySelectorAll(
            "th,td"
          )].map(function (cell) {
            return clean(
              cell.textContent
            );
          });

        if (!rawCells.length) {
          return;
        }

        /*
          Division heading:
            KFC Division
            AFC Division
            NFC Division
        */

        if (
          rawCells.length === 1 &&
          /division$/i.test(
            rawCells[0]
          )
        ) {
          currentDivision =
            rawCells[0]
              .replace(
                /\s+division$/i,
                ""
              )
              .trim();

          return;
        }

        /*
          Header row.
        */

        if (
          rawCells[0]
            ?.toLowerCase() ===
          "team" &&
          rawCells.some(
            function (value) {
              return (
                value.toUpperCase() ===
                "PF"
              );
            }
          )
        ) {
          headers =
            rawCells.map(function (h) {
              return clean(h);
            });

          return;
        }

        const teamLink =
          row.querySelector(
            'a[href*="/teams/"]'
          );

        if (!teamLink) {
          return;
        }

        const teamId =
          parseTeamIdFromHref(
            teamLink.href
          );

        if (!teamId) {
          return;
        }

        const values = {};

        headers.forEach(
          function (header, index) {
            values[header] =
              rawCells[index] ?? "";
          }
        );

        standings.push({
          teamId,

          teamName:
            clean(
              teamLink.textContent
            ),

          division:
            currentDivision,

          wins:
            integerOrNull(
              values.W
            ) ?? 0,

          losses:
            integerOrNull(
              values.L
            ) ?? 0,

          ties:
            integerOrNull(
              values.T
            ) ?? 0,

          percentage:
            numberOrNull(
              values.PCT
            ),

          gamesBack:
            numberOrNull(
              values.GB
            ),

          streak:
            clean(
              values.Streak
            ) || null,

          divisionRecord:
            clean(
              values.Div
            ) || null,

          weeks:
            integerOrNull(
              values.Wks
            ),

          pointsFor:
            numberOrNull(
              values.PF
            ),

          back:
            numberOrNull(
              values.Back
            ),

          pointsAgainst:
            numberOrNull(
              values.PA
            ),
        });
      });

    return standings;
  }

  /*
    ------------------------------------------------
    SCHEDULE COLLECTOR
    ------------------------------------------------
  */

  function captureScheduleFromDocument(
    doc
  ) {
    const schedule = [];

    doc.querySelectorAll("tr")
      .forEach(function (row) {
        const cells =
          [...row.querySelectorAll(
            "th,td"
          )].map(function (cell) {
            return clean(
              cell.textContent
            );
          });

        if (
          cells.length < 2
        ) {
          return;
        }

        const week =
          integerOrNull(
            cells[0]
          );

        if (!week) {
          return;
        }

        const opponentLink =
          row.querySelector(
            'a[href*="/teams/"]'
          );

        if (!opponentLink) {
          return;
        }

        const opponentId =
          parseTeamIdFromHref(
            opponentLink.href
          );

        const rawOpponent =
          clean(
            cells[1]
          );

        const isAway =
          rawOpponent.startsWith("@");

        schedule.push({
          week,

          opponentId,

          opponentName:
            clean(
              opponentLink.textContent
            ),

          homeAway:
            isAway
              ? "away"
              : "home",

          result:
            clean(
              cells[2]
            ) || null,

          teamRecord:
            clean(
              cells[3]
            ) || null,
        });
      });

    return schedule;
  }

  /*
    ------------------------------------------------
    RULES / SETTINGS COLLECTOR
    ------------------------------------------------
  */

  function getTableRows(table) {
    return [...table.querySelectorAll(
      "tr"
    )]
      .map(function (row) {
        const cells =
          [...row.querySelectorAll(
            "th,td"
          )].map(function (cell) {
            return clean(
              cell.textContent
            );
          });

        return cells.some(Boolean)
          ? cells
          : null;
      })
      .filter(Boolean);
  }

  function parseSimpleSettingTable(
    rows
  ) {
    const out = {};

    rows.forEach(function (cells) {
      if (
        cells.length < 2
      ) {
        return;
      }

      const key =
        clean(cells[0]);

      const value =
        clean(cells[1]);

      if (!key || !value) {
        return;
      }

      if (
        key.toLowerCase() ===
        "description" ||
        key.toLowerCase() ===
        "setting"
      ) {
        return;
      }

      out[key] = value;
    });

    return out;
  }

  function parseScoringRules(
    rows
  ) {
    const scoringRules = [];

    let section = null;

    rows.forEach(function (cells) {
      if (
        cells.length < 3
      ) {
        return;
      }

      const first =
        clean(cells[0]);

      const second =
        clean(cells[1]);

      const third =
        clean(cells[2]);

      if (
        /^(offensive|defensive)$/i.test(
          first
        ) &&
        second.toLowerCase() ===
        "name"
      ) {
        section =
          first.toLowerCase();

        return;
      }

      if (
        !section ||
        !first ||
        !second ||
        !third
      ) {
        return;
      }

      scoringRules.push({
        section,
        code: first,
        name: second,
        setting: third,
      });
    });

    return scoringRules;
  }

  function getScoringRule(
    scoringRules,
    code
  ) {
    return scoringRules.find(
      function (rule) {
        return (
          rule.code
            .toLowerCase() ===
          code.toLowerCase()
        );
      }
    ) || null;
  }

  function parseLeadingPoints(
    setting
  ) {
    const match =
      clean(setting).match(
        /^(-?\d+(?:\.\d+)?)\s*points?/i
      );

    return match
      ? Number(match[1])
      : null;
  }

  function parsePerYardPoints(
    setting
  ) {
    const match =
      clean(setting).match(
        /(-?\d+(?:\.\d+)?)\s*points?\s+for\s+every\s+1\s+\w*yd/i
      );

    return match
      ? Number(match[1])
      : null;
  }

  function deriveScoringProfile(
    scoringRules
  ) {
    const reception =
      getScoringRule(
        scoringRules,
        "Recpt"
      );

    const receptionPoints =
      reception
        ? parseLeadingPoints(
            reception.setting
          )
        : null;

    let format = "custom";

    if (receptionPoints === 1) {
      format = "ppr";
    } else if (
      receptionPoints === 0.5
    ) {
      format = "half-ppr";
    } else if (
      receptionPoints === 0 ||
      receptionPoints === null
    ) {
      format = "standard";
    }

    const passingYards =
      getScoringRule(
        scoringRules,
        "PaYd"
      );

    const rushingYards =
      getScoringRule(
        scoringRules,
        "RuYd"
      );

    const receivingYards =
      getScoringRule(
        scoringRules,
        "ReYd"
      );

    const passingYardPoints =
      passingYards
        ? parsePerYardPoints(
            passingYards.setting
          )
        : null;

    const rushingYardPoints =
      rushingYards
        ? parsePerYardPoints(
            rushingYards.setting
          )
        : null;

    const receivingYardPoints =
      receivingYards
        ? parsePerYardPoints(
            receivingYards.setting
          )
        : null;

    return {
      format,

      receptionPoints,

      passing: {
        yardsPerPoint:
          passingYardPoints
            ? 1 /
              passingYardPoints
            : null,

        touchdown:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "PaTD"
            )?.setting
          ),

        interception:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "PaInt"
            )?.setting
          ),

        twoPointConversion:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "Pa2P"
            )?.setting
          ),
      },

      rushing: {
        yardsPerPoint:
          rushingYardPoints
            ? 1 /
              rushingYardPoints
            : null,

        touchdown:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "RuTD"
            )?.setting
          ),

        twoPointConversion:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "Ru2P"
            )?.setting
          ),
      },

      receiving: {
        reception:
          receptionPoints,

        yardsPerPoint:
          receivingYardPoints
            ? 1 /
              receivingYardPoints
            : null,

        touchdown:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "ReTD"
            )?.setting
          ),

        twoPointConversion:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "Re2P"
            )?.setting
          ),
      },

      fumbleLost:
        parseLeadingPoints(
          getScoringRule(
            scoringRules,
            "FL"
          )?.setting
        ),

      kicker: {
        fieldGoals:
          getScoringRule(
            scoringRules,
            "FG"
          )?.setting || null,

        extraPoint:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "XP"
            )?.setting
          ),
      },

      defense: {
        sack:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "SACK"
            )?.setting
          ),

        interception:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "Int"
            )?.setting
          ),

        fumbleRecovery:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "DFR"
            )?.setting
          ),

        forcedFumble:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "FF"
            )?.setting
          ),

        safety:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "STY"
            )?.setting
          ),

        touchdown:
          parseLeadingPoints(
            getScoringRule(
              scoringRules,
              "DTD"
            )?.setting
          ),

        pointsAllowed:
          getScoringRule(
            scoringRules,
            "DSTPA"
          )?.setting || null,

        yardsAllowed:
          getScoringRule(
            scoringRules,
            "YDS"
          )?.setting || null,
      },
    };
  }

  function captureRulesFromDocument(
    doc
  ) {
    const tables =
      [...doc.querySelectorAll(
        "table"
      )];

    const allRows =
      tables.map(
        getTableRows
      );

    const settings = {
      league: {},
      roster: {
        statusLimits: {},
        positions: {},
        extra: [],
      },
      policies: {},
      draft: {},
      competition: {},
      playoffs: {},
      scoringRules: [],
      scoringProfile: null,
    };

    /*
      Detect tables by their contents instead of
      relying exclusively on table indexes.
    */

    allRows.forEach(
      function (rows) {
        if (!rows.length) {
          return;
        }

        const flat =
          rows
            .map(function (row) {
              return row.join(" ");
            })
            .join(" ")
            .toLowerCase();

        /*
          League identity.

          Deliberately DO NOT collect:
            League E-mail Address
            League Entry Fee
        */

        if (
          flat.includes(
            "league name"
          ) &&
          flat.includes(
            "teams"
          ) &&
          flat.includes(
            "divisions"
          )
        ) {
          const map =
            parseSimpleSettingTable(
              rows
            );

          settings.league = {
            name:
              map["League Name"] ||
              "",

            teams:
              integerOrNull(
                map.Teams
              ),

            divisions:
              integerOrNull(
                map.Divisions
              ),
          };

          return;
        }

        /*
          Roster limits.
        */

        if (
          flat.includes(
            "starters"
          ) &&
          flat.includes(
            "total players"
          ) &&
          flat.includes(
            "active max"
          )
        ) {
          let mode =
            "status";

          rows.forEach(
            function (cells) {
              if (
                cells[0] ===
                "Position"
              ) {
                mode =
                  "position";

                return;
              }

              if (
                cells[0] ===
                  "Status" ||
                cells[0] ===
                  "Extra Roster Settings"
              ) {
                return;
              }

              if (
                cells.length === 1
              ) {
                settings
                  .roster
                  .extra
                  .push(
                    cells[0]
                  );

                return;
              }

              if (
                mode ===
                  "status" &&
                cells.length >= 3
              ) {
                settings
                  .roster
                  .statusLimits[
                    cells[0]
                  ] = {
                    min:
                      integerOrNull(
                        cells[1]
                      ),

                    max:
                      integerOrNull(
                        cells[2]
                      ),
                  };

                return;
              }

              if (
                mode ===
                  "position" &&
                cells.length >= 4
              ) {
                settings
                  .roster
                  .positions[
                    cells[0]
                  ] = {
                    activeMin:
                      integerOrNull(
                        cells[1]
                      ),

                    activeMax:
                      integerOrNull(
                        cells[2]
                      ),

                    rosterTotal:
                      cells[3] ===
                      "No Limit"
                        ? null
                        : integerOrNull(
                            cells[3]
                          ),
                  };
              }
            }
          );

          return;
        }

        /*
          Scoring rules.
        */

        if (
          flat.includes(
            "passing td"
          ) &&
          flat.includes(
            "receiving yards"
          )
        ) {
          settings.scoringRules =
            parseScoringRules(
              rows
            );

          return;
        }

        const map =
          parseSimpleSettingTable(
            rows
          );

        /*
          League policies / waiver / lineup rules.
        */

        if (
          map["Lineup Policy"] ||
          map["Add/Drop Policy"] ||
          map["Waivers Run"]
        ) {
          settings.policies =
            map;

          return;
        }

        /*
          Draft settings.
        */

        if (map["Draft Format"]) {
          settings.draft =
            map;

          return;
        }

        /*
          Scoring competition type.
        */

        if (
          map["Scoring System"] ||
          map["Matchup Tiebreaker"]
        ) {
          settings.competition =
            map;

          return;
        }

        /*
          Playoff / standings structure.
        */

        if (
          map["Playoffs Start"] ||
          map["Standings Tiebreaker"]
        ) {
          settings.playoffs =
            map;
        }
      }
    );

    settings.scoringProfile =
      deriveScoringProfile(
        settings.scoringRules
      );

    return settings;
  }

  /*
    ------------------------------------------------
    SCORING PREVIEW COLLECTOR
    ------------------------------------------------
  */

  function getSelectedMatchupLabel(
    doc
  ) {
    const selects =
      [...doc.querySelectorAll(
        "select"
      )];

    for (const select of selects) {
      const value =
        clean(
          select.selectedOptions?.[0]
            ?.textContent
        );

      if (
        value &&
        value.includes("@")
      ) {
        return value;
      }
    }

    /*
      CBS sometimes implements the selector using
      custom controls instead of a native select.

      Search option-like text conservatively.
    */

    const text =
      clean(doc.body?.textContent);

    const match =
      text.match(
        /([A-Za-z0-9'&.\- ]+)\s+@\s+([A-Za-z0-9'&.\- ]+)/
      );

    return match
      ? clean(
          match[1] +
          " @ " +
          match[2]
        )
      : null;
  }

  function capturePreviewFromDocument(
    doc
  ) {
    const tables =
      [...doc.querySelectorAll(
        "table"
      )];

    let teamProjection =
      null;

    const comparisonScores =
      [];

    const playerProjections =
      [];

    tables.forEach(
      function (
        table,
        tableIndex
      ) {
        const rows =
          getTableRows(table);

        if (!rows.length) {
          return;
        }

        /*
          CBS comparison tables have rows such as:

            105 | EVEN | 128

          First matching table after record comparison
          is the overall team projection.
        */

        const first =
          rows[0];

        if (
          first?.length >= 3 &&
          numberOrNull(
            first[0]
          ) !== null &&
          clean(
            first[1]
          ).toUpperCase() ===
            "EVEN" &&
          numberOrNull(
            first[2]
          ) !== null
        ) {
          const comparison = {
            tableIndex,

            left:
              numberOrNull(
                first[0]
              ),

            right:
              numberOrNull(
                first[2]
              ),
          };

          comparisonScores.push(
            comparison
          );

          if (!teamProjection) {
            teamProjection =
              comparison;
          }
        }

        /*
          Some CBS preview tables expose player rows:

            PLAYER | NEWS | matchup | PTS

          Capture only safe fantasy fields.
          News text is intentionally ignored here.
        */

        const header =
          rows[0]
            .map(function (value) {
              return clean(value)
                .toUpperCase();
            });

        if (
          header.includes(
            "PLAYER"
          ) &&
          header.includes(
            "PTS"
          )
        ) {
          const playerIndex =
            header.indexOf(
              "PLAYER"
            );

          const matchupIndex =
            header.indexOf(
              "MATCHUP"
            );

          const pointsIndex =
            header.indexOf(
              "PTS"
            );

          rows.slice(1)
            .forEach(
              function (cells) {
                const playerText =
                  clean(
                    cells[
                      playerIndex
                    ]
                  );

                const pts =
                  numberOrNull(
                    cells[
                      pointsIndex
                    ]
                  );

                if (
                  !playerText ||
                  pts === null
                ) {
                  return;
                }

                /*
                  Typical:
                    Justin HerbertQB • LAC
                */

                const match =
                  playerText.match(
                    /^(.*?)(QB|RB|WR|TE|K|DST)\s*[•·]\s*([A-Z]{2,3})$/i
                  );

                playerProjections.push({
                  name:
                    match
                      ? clean(
                          match[1]
                        )
                      : playerText,

                  position:
                    match
                      ? match[2]
                          .toUpperCase()
                      : "",

                  nflTeam:
                    match
                      ? match[3]
                          .toUpperCase()
                      : "",

                  matchup:
                    matchupIndex >= 0
                      ? clean(
                          cells[
                            matchupIndex
                          ]
                        )
                      : "",

                  projectedPoints:
                    pts,
                });
              }
            );
        }
      }
    );

    const matchupLabel =
      getSelectedMatchupLabel(
        doc
      );

    let awayTeamName = "";
    let homeTeamName = "";

    if (matchupLabel) {
      const pieces =
        matchupLabel
          .split("@")
          .map(clean);

      awayTeamName =
        pieces[0] || "";

      homeTeamName =
        pieces[1] || "";
    }

    return {
      matchupLabel,

      awayTeamName,

      homeTeamName,

      teamProjection:
        teamProjection
          ? {
              awayProjected:
                teamProjection.left,

              homeProjected:
                teamProjection.right,
            }
          : null,

      /*
        Raw comparison pairs are retained because CBS
        exposes a series of position-vs-position scores.
        We do not assign player identity unless CBS exposes
        it unambiguously.
      */

      comparisonScores,

      playerProjections,
    };
  }

  /*
    ------------------------------------------------
    BASIC CAPTURE
    ------------------------------------------------
  */

  function capture() {
    assertCbsFantasyPage();

    const leagueId =
      getLeagueId();

    const leagueName =
      getLeagueNameFromDocument(
        document
      );

    const teamId =
      getTeamIdFromLivePage();

    const teamName =
      getTeamNameFromDocument(
        document
      );

    const season =
      getSeasonFromDocument(
        document
      );

    const roster =
      captureCurrentRoster();

    return {
      league: {
        id: leagueId,
        name: leagueName,
        season,
      },

      team: {
        id: teamId,
        name: teamName,
        wins: 0,
        losses: 0,
        ties: 0,
        rank: null,
      },

      roster,

      matchup: null,

      meta: {
        provider: "cbs",

        connectionMode:
          "browser-assisted",

        readOnly: true,

        captureMode:
          "current-page",

        connectorVersion:
          VERSION,

        capturedAt:
          new Date()
            .toISOString(),

        sourceHost:
          location.hostname,
      },
    };
  }

  /*
    ------------------------------------------------
    FULL MULTI-PAGE CAPTURE
    ------------------------------------------------
  */

  async function captureAll() {
    assertCbsFantasyPage();

    const leagueId =
      getLeagueId();

    /*
      Fetch the CBS pages in parallel.

      These are GET-only requests to the user's current
      authenticated CBS league origin.
    */

    const results =
      await Promise.allSettled([
        fetchLeagueDocument(
          PATHS.roster
        ),

        fetchLeagueDocument(
          PATHS.standings
        ),

        fetchLeagueDocument(
          PATHS.schedule
        ),

        fetchLeagueDocument(
          PATHS.rules
        ),

        fetchLeagueDocument(
          PATHS.preview
        ),
      ]);

    function fulfilled(index) {
      return (
        results[index]
          ?.status ===
        "fulfilled"
          ? results[index].value
          : null
      );
    }

    const rosterPage =
      fulfilled(0);

    const standingsPage =
      fulfilled(1);

    const schedulePage =
      fulfilled(2);

    const rulesPage =
      fulfilled(3);

    const previewPage =
      fulfilled(4);

    /*
      Roster:
      Prefer live-page extraction when the user is
      currently on /teams because that gives us CBS's
      structured roster status metadata.

      Otherwise parse the fetched roster HTML.
    */

    let roster = [];

    if (
      location.pathname ===
        "/teams" ||
      location.pathname.startsWith(
        "/teams/"
      )
    ) {
      roster =
        extractRosterFromDocument(
          document,
          true
        );
    }

    if (
      !roster.length &&
      rosterPage
    ) {
      roster =
        extractRosterFromDocument(
          rosterPage.doc,
          false
        );
    }

    const standings =
      standingsPage
        ? captureStandingsFromDocument(
            standingsPage.doc
          )
        : [];

    const schedule =
      schedulePage
        ? captureScheduleFromDocument(
            schedulePage.doc
          )
        : [];

    const settings =
      rulesPage
        ? captureRulesFromDocument(
            rulesPage.doc
          )
        : null;

    const projections =
      previewPage
        ? capturePreviewFromDocument(
            previewPage.doc
          )
        : null;

    /*
      Determine league identity from the richest
      available page.
    */

    const leagueName =
      getLeagueNameFromDocument(
        rosterPage?.doc ||
        rulesPage?.doc ||
        document
      ) ||
      settings?.league?.name ||
      "";

    const season =
      getSeasonFromDocument(
        rosterPage?.doc ||
        standingsPage?.doc ||
        document
      );

    /*
      Determine user's team ID/name.

      Live CBS metadata is strongest when available.
    */

    let teamId =
      getTeamIdFromLivePage();

    let teamName =
      getTeamNameFromDocument(
        rosterPage?.doc ||
        standingsPage?.doc ||
        document
      );

    /*
      If current-page identity wasn't enough,
      cross-reference standings.
    */

    if (
      teamId &&
      standings.length
    ) {
      const found =
        standings.find(
          function (team) {
            return (
              String(team.teamId) ===
              String(teamId)
            );
          }
        );

      if (found) {
        teamName =
          found.teamName;
      }
    }

    if (
      !teamId &&
      teamName &&
      standings.length
    ) {
      const found =
        standings.find(
          function (team) {
            return (
              clean(team.teamName)
                .toLowerCase() ===
              clean(teamName)
                .toLowerCase()
            );
          }
        );

      if (found) {
        teamId =
          found.teamId;
      }
    }

    /*
      User standings snapshot.
    */

    let myStanding = null;

    if (standings.length) {
      myStanding =
        standings.find(
          function (team) {
            if (
              teamId &&
              String(team.teamId) ===
                String(teamId)
            ) {
              return true;
            }

            return (
              teamName &&
              clean(team.teamName)
                .toLowerCase() ===
              clean(teamName)
                .toLowerCase()
            );
          }
        ) || null;
    }

    const standingRank =
      myStanding
        ? standings
            .slice()
            .sort(
              function (a, b) {
                const aPct =
                  a.percentage ?? 0;

                const bPct =
                  b.percentage ?? 0;

                if (
                  bPct !== aPct
                ) {
                  return (
                    bPct - aPct
                  );
                }

                return (
                  (b.pointsFor ?? 0) -
                  (a.pointsFor ?? 0)
                );
              }
            )
            .findIndex(
              function (team) {
                return (
                  team.teamId ===
                  myStanding.teamId
                );
              }
            ) + 1
        : null;

    /*
      Current matchup object.

      Until the season has live scoring, team projection
      is the strongest matchup signal CBS exposes here.
    */

    let matchup = null;

    if (
      projections
        ?.teamProjection
    ) {
      const myIsHome =
        teamName &&
        projections.homeTeamName &&
        clean(
          projections.homeTeamName
        ).toLowerCase() ===
        clean(teamName)
          .toLowerCase();

      const myIsAway =
        teamName &&
        projections.awayTeamName &&
        clean(
          projections.awayTeamName
        ).toLowerCase() ===
        clean(teamName)
          .toLowerCase();

      if (
        myIsHome ||
        myIsAway
      ) {
        const myProjected =
          myIsHome
            ? projections
                .teamProjection
                .homeProjected
            : projections
                .teamProjection
                .awayProjected;

        const opponentProjected =
          myIsHome
            ? projections
                .teamProjection
                .awayProjected
            : projections
                .teamProjection
                .homeProjected;

        matchup = {
          opponentName:
            myIsHome
              ? projections
                  .awayTeamName
              : projections
                  .homeTeamName,

          myProjected,

          opponentProjected,

          /*
            Do not manufacture a probability from
            projection totals here.
          */
          winProbability: null,
        };
      }
    }

    /*
      Update roster projections if CBS exposed a
      player projection row with a clear name match.
    */

    if (
      roster.length &&
      projections
        ?.playerProjections
        ?.length
    ) {
      const projectionByName =
        new Map();

      projections
        .playerProjections
        .forEach(
          function (player) {
            projectionByName.set(
              clean(player.name)
                .toLowerCase(),
              player
            );
          }
        );

      roster =
        roster.map(
          function (player) {
            const projection =
              projectionByName.get(
                clean(player.name)
                  .toLowerCase()
              );

            return projection
              ? {
                  ...player,

                  projectedPoints:
                    projection
                      .projectedPoints,
                }
              : player;
          }
        );
    }

    /*
      Capture warnings instead of failing the entire
      connection when one non-critical CBS page changes.
    */

    const warnings = [];

    const labels = [
      "roster",
      "standings",
      "schedule",
      "rules",
      "scoring preview",
    ];

    results.forEach(
      function (
        result,
        index
      ) {
        if (
          result.status ===
          "rejected"
        ) {
          warnings.push(
            "Could not collect CBS " +
            labels[index] +
            ": " +
            clean(
              result.reason
                ?.message
            )
          );
        }
      }
    );

    return {
      league: {
        id:
          leagueId,

        name:
          leagueName,

        season,

        teamCount:
          settings
            ?.league
            ?.teams ??
          standings.length ??
          null,

        divisionCount:
          settings
            ?.league
            ?.divisions ??
          null,
      },

      team: {
        id:
          teamId,

        name:
          teamName,

        division:
          myStanding
            ?.division ??
          null,

        wins:
          myStanding
            ?.wins ??
          0,

        losses:
          myStanding
            ?.losses ??
          0,

        ties:
          myStanding
            ?.ties ??
          0,

        rank:
          standingRank,

        pointsFor:
          myStanding
            ?.pointsFor ??
          null,

        pointsAgainst:
          myStanding
            ?.pointsAgainst ??
          null,
      },

      roster,

      standings,

      schedule,

      settings,

      projections,

      matchup,

      meta: {
        provider:
          "cbs",

        connectionMode:
          "browser-assisted",

        readOnly:
          true,

        captureMode:
          "multi-page",

        connectorVersion:
          VERSION,

        capturedAt:
          new Date()
            .toISOString(),

        sourceHost:
          location.hostname,

        pagesRequested: {
          roster:
            PATHS.roster,

          standings:
            PATHS.standings,

          schedule:
            PATHS.schedule,

          rules:
            PATHS.rules,

          preview:
            PATHS.preview,
        },

        warnings,
      },
    };
  }

  /*
    ------------------------------------------------
    PUBLIC API
    ------------------------------------------------
  */

  window.CBSBrowserConnector = {
    version:
      VERSION,

    isCbsFantasyPage,

    /*
      Original synchronous roster capture.
    */
    capture,

    /*
      Full CBS league capture.
    */
    captureAll,

    /*
      Expose page collectors for testing only.
      These remain READ ONLY.
    */
    collectors: {
      standings:
        captureStandingsFromDocument,

      schedule:
        captureScheduleFromDocument,

      rules:
        captureRulesFromDocument,

      preview:
        capturePreviewFromDocument,
    },
  };
})();
