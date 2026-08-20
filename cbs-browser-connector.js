/*
  THE INNER SANCTUM — cbs-browser-connector.js
  ------------------------------------------------
  Browser-assisted, READ-ONLY CBS Fantasy connector.

  VERSION 0.2.1

  PURPOSE
  ------------------------------------------------
  Collects fantasy-football league information that CBS already
  exposes to a user who is normally authenticated in their own
  CBS Fantasy Football league.

  PROVEN DATA SURFACES
  ------------------------------------------------
  /teams
    - league identity
    - user team identity
    - roster
    - CBS player IDs
    - actual player positions
    - NFL teams
    - active / reserve status

  /standings/overall
    - all league teams
    - CBS team IDs
    - divisions
    - wins / losses / ties
    - winning percentage
    - games back
    - streak
    - division record
    - points for
    - points against

  /schedule/team
    - weekly opponent
    - opponent CBS team ID
    - home / away
    - result
    - team record

  /rules
    - team count
    - division count
    - roster limits
    - starting lineup requirements
    - lineup policies
    - waiver policies
    - draft settings
    - custom scoring rules
    - scoring format
    - playoff structure

  /scoring/preview
    - team matchup projections
    - starter comparison projections
    - player projection rows where CBS exposes them

  SECURITY BOUNDARY
  ------------------------------------------------
  This connector:

    - DOES NOT collect CBS usernames
    - DOES NOT collect CBS passwords
    - DOES NOT read browser cookies
    - DOES NOT return browser cookies
    - DOES NOT read Authorization headers
    - DOES NOT return CBS access/session tokens
    - DOES NOT solve or bypass CAPTCHA
    - DOES NOT perform transactions
    - DOES NOT change lineups
    - DOES NOT add/drop players
    - DOES NOT collect league entry fees
    - DOES NOT collect league email addresses

  The connector performs GET-only requests against the SAME CBS
  league origin that the user is already authenticated into.

  PUBLIC API
  ------------------------------------------------

      CBSBrowserConnector.capture()

        Synchronous current-page roster capture.
        Primarily retained for compatibility/testing.

      await CBSBrowserConnector.captureAll()

        Full multi-page league capture.

  Intended downstream usage:

      const raw =
        await CBSBrowserConnector.captureAll();

      const normalized =
        normalizeLeagueData("cbs", raw);
*/

(function () {
  "use strict";

  const VERSION = "0.2.1";

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
    ================================================================
    GENERIC HELPERS
    ================================================================
  */

  function clean(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function numberOrNull(value) {
    const text = clean(value);

    if (
      !text ||
      text === "-" ||
      text === "—"
    ) {
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
    const n =
      numberOrNull(value);

    return Number.isInteger(n)
      ? n
      : null;
  }

  function parseTeamIdFromHref(href) {
    if (!href) {
      return null;
    }

    const match =
      String(href).match(
        /\/teams\/(\d+)(?:[/?#]|$)/i
      );

    return match
      ? match[1]
      : null;
  }

  function parsePlayerIdFromHref(href) {
    if (!href) {
      return null;
    }

    const match =
      String(href).match(
        /\/players\/playerpage\/(\d+)(?:[/?#]|$)/i
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

  function parseHtml(html) {
    return new DOMParser()
      .parseFromString(
        html,
        "text/html"
      );
  }

  /*
    ================================================================
    LEAGUE / TEAM IDENTITY HELPERS
    ================================================================
  */

  function getSeasonFromDocument(doc) {
    /*
      First look for an explicitly-selected season control.
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
      CBS often initializes the fantasy year in page JavaScript.
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
      If this is the actual live page, CBS may expose the year
      on FantasyGlobalChatJson.
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
        // Safe fallback below.
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
      /rules fallback.
    */

    for (
      const row of
      doc.querySelectorAll("tr")
    ) {
      const cells =
        [...row.querySelectorAll(
          "th,td"
        )].map(function (cell) {
          return clean(
            cell.textContent
          );
        });

      if (
        clean(cells[0])
          .toLowerCase() ===
        "league name"
      ) {
        return clean(
          cells[1]
        );
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
      Schedule pages often expose:
        The Vanilla Gorilla (0-0-0)
    */

    const rows =
      [...doc.querySelectorAll("tr")];

    for (const row of rows) {
      const text =
        clean(row.textContent);

      const match =
        text.match(
          /^(.+?)\s+\(\d+-\d+-\d+\)$/
        );

      if (match) {
        return clean(
          match[1]
        );
      }
    }

    return "";
  }

  function getTeamIdFromLivePage() {
    const inputValue =
      document.querySelector(
        'input[name="team"]'
      )?.value;

    if (inputValue) {
      return clean(
        inputValue
      );
    }

    try {
      const id =
        window.FantasyGlobalChatJson
          ?.userAuth
          ?.attrib
          ?.team
          ?.id;

      if (
        id !== undefined &&
        id !== null
      ) {
        return clean(id);
      }
    } catch (e) {
      // Ignore and fall through.
    }

    return null;
  }

  /*
    ================================================================
    SAFE SAME-ORIGIN PAGE FETCH
    ================================================================
  */

  async function fetchLeagueDocument(path) {
    assertCbsFantasyPage();

    const url =
      new URL(
        path,
        location.origin
      );

    if (
      url.origin !==
      location.origin
    ) {
      throw new Error(
        "CBS connector refused a cross-origin request."
      );
    }

    const response =
      await fetch(
        url.href,
        {
          method: "GET",

          /*
            Browser sends its existing CBS authentication normally.
            The connector never inspects or returns cookie values.
          */
          credentials:
            "same-origin",

          cache:
            "no-store",

          headers: {
            Accept:
              "text/html",
          },
        }
      );

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
      url:
        url.href,

      html,

      doc:
        parseHtml(html),
    };
  }

  /*
    ================================================================
    CBS EMBEDDED PLAYER METADATA
    ================================================================

    When /teams is fetched in the background, the JavaScript in that
    fetched page does not execute in our current window.

    CBS does, however, place useful roster metadata inside script text.

    We inspect those scripts ONLY for safe fantasy metadata:

      - CBS player ID
      - full name
      - roster status
      - NFL team
      - current position

    We intentionally do NOT collect tokens, auth IDs or other
    credential/session values from those scripts.
  */

  function extractEmbeddedPlayerMeta(doc) {
    const playerMeta = {};

    for (const script of doc.scripts) {
      const text =
        script.textContent || "";

      if (
        !text.includes(
          '"fullName"'
        ) ||
        !text.includes(
          '"status"'
        )
      ) {
        continue;
      }

      const idRegex =
        /"id"\s*:\s*"(\d+)"/g;

      let match;

      while (
        (
          match =
            idRegex.exec(text)
        ) !== null
      ) {
        const playerId =
          match[1];

        /*
          CBS player objects are compact enough that a bounded text
          window around the ID reliably contains the player's safe
          metadata without requiring us to evaluate CBS JavaScript.
        */

        const start =
          Math.max(
            0,
            match.index - 1400
          );

        const end =
          Math.min(
            text.length,
            match.index + 2000
          );

        const block =
          text.slice(
            start,
            end
          );

        const nameMatch =
          block.match(
            /"fullName"\s*:\s*"([^"]+)"/
          );

        const statusMatch =
          block.match(
            /"status"\s*:\s*"([^"]+)"/
          );

        const teamMatches =
          [...block.matchAll(
            /"team"\s*:\s*"([^"]+)"/g
          )];

        const currPosMatch =
          block.match(
            /"currPos"\s*:\s*"([^"]+)"/
          );

        const teamMatch =
          teamMatches.length
            ? teamMatches[
                teamMatches.length - 1
              ]
            : null;

        if (
          !nameMatch &&
          !statusMatch &&
          !teamMatch &&
          !currPosMatch
        ) {
          continue;
        }

        playerMeta[playerId] = {
          cbsPlayerId:
            playerId,

          fullName:
            clean(
              nameMatch?.[1]
            ),

          status:
            clean(
              statusMatch?.[1]
            ) || null,

          team:
            clean(
              teamMatch?.[1]
            ),

          position:
            clean(
              currPosMatch?.[1]
            ),
        };
      }
    }

    return playerMeta;
  }

  /*
    ================================================================
    ROSTER COLLECTOR
    ================================================================
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
      Object.values(
        rosterMap
      ).find(
        function (player) {
          return (
            String(
              player?.id ?? ""
            ) ===
            String(cbsPlayerId)
          );
        }
      ) || {}
    );
  }

  function getActualPosition(
    row,
    playerData
  ) {
    /*
      CBS lineup slot may be FLEX/RB-WR-TE.
      CBS eligibility current position is preferred.
    */

    const eligibilityPosition =
      clean(
        playerData
          ?.elig
          ?.currPos
      );

    if (
      eligibilityPosition &&
      !eligibilityPosition.includes(
        "-"
      )
    ) {
      return eligibilityPosition;
    }

    /*
      Common display:
        QB • JAC
        RB • BAL
        WR • DEN
    */

    const playerMeta =
      clean(
        row.querySelector(
          ".playerPositionAndTeam"
        )?.textContent
      );

    if (playerMeta) {
      const parts =
        playerMeta
          .split(/[•·]/)
          .map(clean)
          .filter(Boolean);

      if (parts[0]) {
        return parts[0];
      }
    }

    /*
      Separate position column fallback.
    */

    const tablePosition =
      clean(
        row.querySelector(
          ".playerPosition"
        )?.textContent
      );

    if (
      tablePosition &&
      !tablePosition.includes(
        "-"
      )
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
    const structuredTeam =
      clean(
        playerData?.team
      );

    if (structuredTeam) {
      return structuredTeam;
    }

    const playerMeta =
      clean(
        row.querySelector(
          ".playerPositionAndTeam"
        )?.textContent
      );

    if (!playerMeta) {
      return "";
    }

    const parts =
      playerMeta
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

    const embeddedMeta =
      useLiveRosterMap
        ? {}
        : extractEmbeddedPlayerMeta(
            doc
          );

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

      const cbsPlayerId =
        parsePlayerIdFromHref(
          link.href
        );

      if (
        !cbsPlayerId ||
        seen.has(cbsPlayerId)
      ) {
        return;
      }

      seen.add(
        cbsPlayerId
      );

      const playerData =
        findRosterMapPlayer(
          rosterMap,
          row,
          cbsPlayerId
        );

      const embedded =
        embeddedMeta[
          cbsPlayerId
        ] || {};

      const name =
        clean(
          playerData
            ?.fullName
        ) ||
        clean(
          embedded.fullName
        ) ||
        clean(
          link.textContent
        );

      if (!name) {
        return;
      }

      let position =
        getActualPosition(
          row,
          playerData
        );

      /*
        When rosterMap does not exist because /teams was fetched
        in the background, prefer CBS's embedded actual position.
      */

      if (
        (
          !position ||
          position.includes(
            "-"
          )
        ) &&
        embedded.position
      ) {
        position =
          embedded.position;
      }

      /*
        If the DOM gave us a FLEX-style slot but CBS's embedded
        metadata knows the real player position, use the real one.
      */

      if (
        position.includes(
          "-"
        ) &&
        embedded.position &&
        !embedded.position.includes(
          "-"
        )
      ) {
        position =
          embedded.position;
      }

      let nflTeam =
        getNflTeam(
          row,
          playerData
        );

      if (
        !nflTeam &&
        embedded.team
      ) {
        nflTeam =
          embedded.team;
      }

      const status =
        clean(
          playerData
            ?.status
        ) ||
        clean(
          embedded.status
        ) ||
        null;

      roster.push({
        cbsPlayerId,

        name,

        position,

        nflTeam,

        status,

        projectedPoints:
          0,
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
        "No CBS roster players were found on this page. Open the CBS My Team roster page before running the basic capture."
      );
    }

    return roster;
  }

  /*
    ================================================================
    STANDINGS COLLECTOR
    ================================================================
  */

  function captureStandingsFromDocument(
    doc
  ) {
    const standings = [];

    let currentDivision =
      "";

    let headers =
      [];

    doc.querySelectorAll(
      "tr"
    ).forEach(function (row) {
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
        Division headings:
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
          rawCells.map(
            function (header) {
              return clean(
                header
              );
            }
          );

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
        function (
          header,
          index
        ) {
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
    ================================================================
    SCHEDULE COLLECTOR
    ================================================================
  */

  function captureScheduleFromDocument(
    doc
  ) {
    const schedule = [];

    doc.querySelectorAll(
      "tr"
    ).forEach(function (row) {
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
        rawOpponent
          .startsWith("@");

      schedule.push({
        week,

        opponentId,

        opponentName:
          clean(
            opponentLink
              .textContent
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
    ================================================================
    RULES / SETTINGS COLLECTOR
    ================================================================
  */

  function getTableRows(table) {
    return [
      ...table.querySelectorAll(
        "tr"
      ),
    ]
      .map(function (row) {
        const cells =
          [...row.querySelectorAll(
            "th,td"
          )].map(function (cell) {
            return clean(
              cell.textContent
            );
          });

        return cells.some(
          Boolean
        )
          ? cells
          : null;
      })
      .filter(Boolean);
  }

  function parseSimpleSettingTable(
    rows
  ) {
    const out = {};

    rows.forEach(
      function (cells) {
        if (
          cells.length < 2
        ) {
          return;
        }

        const key =
          clean(
            cells[0]
          );

        const value =
          clean(
            cells[1]
          );

        if (
          !key ||
          !value
        ) {
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

        out[key] =
          value;
      }
    );

    return out;
  }

  function parseScoringRules(
    rows
  ) {
    const scoringRules =
      [];

    let section =
      null;

    rows.forEach(
      function (cells) {
        if (
          cells.length < 3
        ) {
          return;
        }

        const first =
          clean(
            cells[0]
          );

        const second =
          clean(
            cells[1]
          );

        const third =
          clean(
            cells[2]
          );

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

          code:
            first,

          name:
            second,

          setting:
            third,
        });
      }
    );

    return scoringRules;
  }

  function getScoringRule(
    scoringRules,
    code
  ) {
    return (
      scoringRules.find(
        function (rule) {
          return (
            rule.code
              .toLowerCase() ===
            code.toLowerCase()
          );
        }
      ) || null
    );
  }

  function parseLeadingPoints(
    setting
  ) {
    const text =
      clean(setting);

    if (!text) {
      return null;
    }

    const match =
      text.match(
        /^(-?\d+(?:\.\d+)?)\s*points?/i
      );

    return match
      ? Number(
          match[1]
        )
      : null;
  }

  function parsePerYardPoints(
    setting
  ) {
    const text =
      clean(setting);

    if (!text) {
      return null;
    }

    const match =
      text.match(
        /=\s*(-?\d+(?:\.\d+)?)\s*points?\s+for\s+every\s+1\s+\w*yd/i
      ) ||
      text.match(
        /(-?\d+(?:\.\d+)?)\s*points?\s+for\s+every\s+1\s+\w*yd/i
      );

    return match
      ? Number(
          match[1]
        )
      : null;
  }

  function deriveScoringProfile(
    scoringRules
  ) {
    const receptionRule =
      getScoringRule(
        scoringRules,
        "Recpt"
      );

    const receptionPoints =
      receptionRule
        ? parseLeadingPoints(
            receptionRule.setting
          )
        : null;

    let format =
      "custom";

    if (
      receptionPoints === 1
    ) {
      format =
        "ppr";
    } else if (
      receptionPoints === 0.5
    ) {
      format =
        "half-ppr";
    } else if (
      receptionPoints === 0 ||
      receptionPoints === null
    ) {
      format =
        "standard";
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
          )?.setting ||
          null,

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
          )?.setting ||
          null,

        yardsAllowed:
          getScoringRule(
            scoringRules,
            "YDS"
          )?.setting ||
          null,
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

      scoringProfile:
        null,
    };

    allRows.forEach(
      function (rows) {
        if (!rows.length) {
          return;
        }

        const flat =
          rows
            .map(
              function (row) {
                return row.join(
                  " "
                );
              }
            )
            .join(" ")
            .toLowerCase();

        /*
          LEAGUE IDENTITY

          Deliberately ignore:
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
              map[
                "League Name"
              ] || "",

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
          ROSTER LIMITS
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
          CUSTOM SCORING RULES
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
          LINEUP / WAIVER / TRANSACTION POLICIES
        */

        if (
          map[
            "Lineup Policy"
          ] ||
          map[
            "Add/Drop Policy"
          ] ||
          map[
            "Waivers Run"
          ]
        ) {
          settings.policies =
            map;

          return;
        }

        /*
          DRAFT SETTINGS
        */

        if (
          map[
            "Draft Format"
          ]
        ) {
          settings.draft =
            map;

          return;
        }

        /*
          COMPETITION / SCORING TYPE
        */

        if (
          map[
            "Scoring System"
          ] ||
          map[
            "Matchup Tiebreaker"
          ]
        ) {
          settings.competition =
            map;

          return;
        }

        /*
          PLAYOFF / STANDINGS STRUCTURE
        */

        if (
          map[
            "Playoffs Start"
          ] ||
          map[
            "Standings Tiebreaker"
          ]
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
    ================================================================
    SCORING PREVIEW HELPERS
    ================================================================
  */

  function parsePreviewPlayerText(
    text
  ) {
    const cleaned =
      clean(text);

    if (!cleaned) {
      return null;
    }

    /*
      Common CBS player text:
        Trevor LawrenceQB • JAC
        Trevor Lawrence QB • JAC
    */

    const match =
      cleaned.match(
        /^(.*?)(QB|RB|WR|TE|K|DST)\s*[•·]\s*([A-Z]{2,3})$/i
      );

    if (!match) {
      return {
        name:
          cleaned,

        position:
          "",

        nflTeam:
          "",
      };
    }

    return {
      name:
        clean(
          match[1]
        ),

      position:
        match[2]
          .toUpperCase(),

      nflTeam:
        match[3]
          .toUpperCase(),
    };
  }

  function findNearbyPreviewPlayers(
    table
  ) {
    /*
      CBS starter comparisons are rendered inside larger containers.
      Walk upward until exactly-relevant player links can be located.

      We de-duplicate by CBS player ID and preserve DOM order.
    */

    let node =
      table;

    for (
      let depth = 0;
      depth < 7 &&
      node;
      depth++
    ) {
      const links =
        [...node.querySelectorAll(
          'a[href*="/players/playerpage/"]'
        )];

      const unique = [];

      const seen =
        new Set();

      links.forEach(
        function (link) {
          const id =
            parsePlayerIdFromHref(
              link.href
            );

          if (
            !id ||
            seen.has(id)
          ) {
            return;
          }

          seen.add(id);

          unique.push({
            cbsPlayerId:
              id,

            text:
              clean(
                link.textContent
              ),

            link,
          });
        }
      );

      /*
        The immediate comparison container should resolve to two
        relevant players. If a larger parent contains many players,
        continue cautiously rather than incorrectly pairing distant
        roster entries.
      */

      if (
        unique.length === 2
      ) {
        return unique;
      }

      if (
        unique.length > 2
      ) {
        /*
          Try to identify the closest links physically before/after
          the comparison table.
        */

        const ordered =
          unique.filter(
            function (item) {
              return Boolean(
                item.link
              );
            }
          );

        if (
          ordered.length >= 2
        ) {
          return [
            ordered[0],
            ordered[
              ordered.length - 1
            ],
          ];
        }
      }

      node =
        node.parentElement;
    }

    return [];
  }

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
      CBS custom-control fallback.
    */

    const bodyText =
      clean(
        doc.body?.textContent
      );

    const match =
      bodyText.match(
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

  /*
    ================================================================
    SCORING PREVIEW COLLECTOR
    ================================================================
  */

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

    /*
      Keep projections by player ID whenever possible.
      Name fallback is supported for CBS rows that don't expose IDs.
    */

    const playerProjectionMap =
      new Map();

    tables.forEach(
      function (
        table,
        tableIndex
      ) {
        const rows =
          getTableRows(
            table
          );

        if (!rows.length) {
          return;
        }

        /*
          CBS graphical comparison rows look like:

            105 | EVEN | 128

          First score comparison = team matchup projection.

          Later score comparisons = starter-vs-starter projections.
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
          const left =
            numberOrNull(
              first[0]
            );

          const right =
            numberOrNull(
              first[2]
            );

          const comparison = {
            tableIndex,

            left,

            right,
          };

          comparisonScores.push(
            comparison
          );

          if (!teamProjection) {
            teamProjection = {
              tableIndex,

              left,

              right,
            };
          } else {
            /*
              Subsequent comparison tables should correspond to the
              two player cards around the table.
            */

            const nearbyPlayers =
              findNearbyPreviewPlayers(
                table
              );

            if (
              nearbyPlayers.length ===
              2
            ) {
              const leftPlayer =
                nearbyPlayers[0];

              const rightPlayer =
                nearbyPlayers[1];

              playerProjectionMap.set(
                "id:" +
                  leftPlayer
                    .cbsPlayerId,
                {
                  cbsPlayerId:
                    leftPlayer
                      .cbsPlayerId,

                  name:
                    leftPlayer.text,

                  projectedPoints:
                    left,

                  source:
                    "starter-comparison",
                }
              );

              playerProjectionMap.set(
                "id:" +
                  rightPlayer
                    .cbsPlayerId,
                {
                  cbsPlayerId:
                    rightPlayer
                      .cbsPlayerId,

                  name:
                    rightPlayer.text,

                  projectedPoints:
                    right,

                  source:
                    "starter-comparison",
                }
              );
            }
          }
        }

        /*
          CBS additionally exposes normal player rows:

            PLAYER | NEWS | MATCHUP | PTS

          Commonly useful for reserves / bench.
        */

        const header =
          rows[0].map(
            function (value) {
              return clean(
                value
              ).toUpperCase();
            }
          );

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

          const domRows =
            [...table.querySelectorAll(
              "tr"
            )];

          rows
            .slice(1)
            .forEach(
              function (
                cells,
                logicalIndex
              ) {
                const pts =
                  numberOrNull(
                    cells[
                      pointsIndex
                    ]
                  );

                if (
                  pts === null
                ) {
                  return;
                }

                const domRow =
                  domRows[
                    logicalIndex + 1
                  ];

                const playerLink =
                  domRow
                    ?.querySelector(
                      'a[href*="/players/playerpage/"]'
                    );

                const cbsPlayerId =
                  playerLink
                    ? parsePlayerIdFromHref(
                        playerLink.href
                      )
                    : null;

                const parsed =
                  parsePreviewPlayerText(
                    cells[
                      playerIndex
                    ]
                  );

                if (
                  !parsed?.name
                ) {
                  return;
                }

                const projection = {
                  cbsPlayerId,

                  name:
                    parsed.name,

                  position:
                    parsed.position,

                  nflTeam:
                    parsed.nflTeam,

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

                  source:
                    "player-table",
                };

                const key =
                  cbsPlayerId
                    ? "id:" +
                      cbsPlayerId
                    : "name:" +
                      clean(
                        parsed.name
                      ).toLowerCase();

                playerProjectionMap.set(
                  key,
                  projection
                );
              }
            );
        }
      }
    );

    const matchupLabel =
      getSelectedMatchupLabel(
        doc
      );

    let awayTeamName =
      "";

    let homeTeamName =
      "";

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

      comparisonScores,

      playerProjections:
        [
          ...playerProjectionMap
            .values(),
        ],
    };
  }

  /*
    ================================================================
    BASIC CURRENT-PAGE CAPTURE
    ================================================================
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
        id:
          leagueId,

        name:
          leagueName,

        season,
      },

      team: {
        id:
          teamId,

        name:
          teamName,

        wins:
          0,

        losses:
          0,

        ties:
          0,

        rank:
          null,
      },

      roster,

      matchup:
        null,

      meta: {
        provider:
          "cbs",

        connectionMode:
          "browser-assisted",

        readOnly:
          true,

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
    ================================================================
    FULL MULTI-PAGE CAPTURE
    ================================================================
  */

  async function captureAll() {
    assertCbsFantasyPage();

    const leagueId =
      getLeagueId();

    /*
      Load CBS pages in parallel.

      Every request is:
        - GET only
        - same CBS league origin
        - browser-authenticated normally
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
          ? results[index]
              .value
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
      ------------------------------------------------
      ROSTER
      ------------------------------------------------

      If user happens to be on /teams, use the live structured
      LineupBuilder.

      Otherwise parse the fetched /teams document plus safe embedded
      player metadata.
    */

    let roster = [];

    if (
      location.pathname ===
        "/teams" ||
      /^\/teams\/?\d*$/i.test(
        location.pathname
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

    /*
      ------------------------------------------------
      STANDINGS
      ------------------------------------------------
    */

    const standings =
      standingsPage
        ? captureStandingsFromDocument(
            standingsPage.doc
          )
        : [];

    /*
      ------------------------------------------------
      SCHEDULE
      ------------------------------------------------
    */

    const schedule =
      schedulePage
        ? captureScheduleFromDocument(
            schedulePage.doc
          )
        : [];

    /*
      ------------------------------------------------
      SETTINGS / SCORING
      ------------------------------------------------
    */

    const settings =
      rulesPage
        ? captureRulesFromDocument(
            rulesPage.doc
          )
        : null;

    /*
      ------------------------------------------------
      PROJECTIONS / MATCHUP
      ------------------------------------------------
    */

    const projections =
      previewPage
        ? capturePreviewFromDocument(
            previewPage.doc
          )
        : null;

    /*
      ------------------------------------------------
      LEAGUE IDENTITY
      ------------------------------------------------
    */

    const leagueName =
      getLeagueNameFromDocument(
        rosterPage?.doc ||
        rulesPage?.doc ||
        standingsPage?.doc ||
        document
      ) ||
      settings
        ?.league
        ?.name ||
      "";

    const season =
      getSeasonFromDocument(
        rosterPage?.doc ||
        standingsPage?.doc ||
        rulesPage?.doc ||
        document
      );

    /*
      ------------------------------------------------
      USER TEAM IDENTITY
      ------------------------------------------------
    */

    let teamId =
      getTeamIdFromLivePage();

    let teamName =
      getTeamNameFromDocument(
        rosterPage?.doc ||
        schedulePage?.doc ||
        standingsPage?.doc ||
        document
      );

    /*
      CBS standings provide an authoritative team ID/name mapping.
    */

    if (
      teamId &&
      standings.length
    ) {
      const found =
        standings.find(
          function (team) {
            return (
              String(
                team.teamId
              ) ===
              String(
                teamId
              )
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
              clean(
                team.teamName
              ).toLowerCase() ===
              clean(
                teamName
              ).toLowerCase()
            );
          }
        );

      if (found) {
        teamId =
          found.teamId;
      }
    }

    /*
      ------------------------------------------------
      USER STANDING
      ------------------------------------------------
    */

    let myStanding =
      null;

    if (standings.length) {
      myStanding =
        standings.find(
          function (team) {
            if (
              teamId &&
              String(
                team.teamId
              ) ===
                String(
                  teamId
                )
            ) {
              return true;
            }

            return Boolean(
              teamName &&
              clean(
                team.teamName
              ).toLowerCase() ===
                clean(
                  teamName
                ).toLowerCase()
            );
          }
        ) || null;
    }

    /*
      CBS renders teams in an order even before games have been played.

      Do NOT manufacture a preseason league rank from that order.
    */

    const seasonHasResults =
      standings.some(
        function (team) {
          return (
            (
              team.wins ??
              0
            ) > 0 ||
            (
              team.losses ??
              0
            ) > 0 ||
            (
              team.ties ??
              0
            ) > 0 ||
            (
              team.weeks ??
              0
            ) > 0 ||
            (
              team.pointsFor ??
              0
            ) > 0 ||
            (
              team.pointsAgainst ??
              0
            ) > 0
          );
        }
      );

    const standingRank =
      myStanding &&
      seasonHasResults
        ? standings
            .slice()
            .sort(
              function (
                a,
                b
              ) {
                const aPct =
                  a.percentage ??
                  0;

                const bPct =
                  b.percentage ??
                  0;

                if (
                  bPct !==
                  aPct
                ) {
                  return (
                    bPct -
                    aPct
                  );
                }

                return (
                  (
                    b.pointsFor ??
                    0
                  ) -
                  (
                    a.pointsFor ??
                    0
                  )
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
      ------------------------------------------------
      MATCHUP
      ------------------------------------------------
    */

    let matchup =
      null;

    if (
      projections
        ?.teamProjection
    ) {
      const myIsHome =
        Boolean(
          teamName &&
          projections
            .homeTeamName &&
          clean(
            projections
              .homeTeamName
          ).toLowerCase() ===
            clean(
              teamName
            ).toLowerCase()
        );

      const myIsAway =
        Boolean(
          teamName &&
          projections
            .awayTeamName &&
          clean(
            projections
              .awayTeamName
          ).toLowerCase() ===
            clean(
              teamName
            ).toLowerCase()
        );

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
            Sanctum should not pretend CBS projection difference
            equals a calibrated win probability.
          */
          winProbability:
            null,
        };
      }
    }

    /*
      ------------------------------------------------
      PLAYER PROJECTION JOIN
      ------------------------------------------------

      CBS player ID = primary join key.
      Name = fallback only.
    */

    if (
      roster.length &&
      projections
        ?.playerProjections
        ?.length
    ) {
      const projectionById =
        new Map();

      const projectionByName =
        new Map();

      projections
        .playerProjections
        .forEach(
          function (player) {
            if (
              player
                .cbsPlayerId
            ) {
              projectionById.set(
                String(
                  player
                    .cbsPlayerId
                ),
                player
              );
            }

            if (player.name) {
              projectionByName.set(
                clean(
                  player.name
                ).toLowerCase(),
                player
              );
            }
          }
        );

      roster =
        roster.map(
          function (player) {
            const projection =
              projectionById.get(
                String(
                  player
                    .cbsPlayerId
                )
              ) ||
              projectionByName.get(
                clean(
                  player.name
                ).toLowerCase()
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
      ------------------------------------------------
      COLLECTION WARNINGS
      ------------------------------------------------

      A noncritical CBS page failure should not destroy an otherwise
      valid connection. Record the warning and allow caller/UI to
      decide how to handle partial data.
    */

    const warnings =
      [];

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

    /*
      ------------------------------------------------
      DATA QUALITY
      ------------------------------------------------

      Makes connector health explicit without exposing credentials.

      This will eventually be very useful in the consumer connection
      screen and for diagnosing CBS layout changes.
    */

    const dataQuality = {
      leagueIdentity:
        Boolean(
          leagueId &&
          leagueName
        ),

      teamIdentity:
        Boolean(
          teamId &&
          teamName
        ),

      roster:
        roster.length > 0,

      rosterCount:
        roster.length,

      rosterStatuses:
        roster.some(
          function (player) {
            return Boolean(
              player.status
            );
          }
        ),

      standings:
        standings.length >
        0,

      standingsCount:
        standings.length,

      schedule:
        schedule.length >
        0,

      scheduleCount:
        schedule.length,

      scoringRules:
        Boolean(
          settings
            ?.scoringRules
            ?.length
        ),

      scoringRuleCount:
        settings
          ?.scoringRules
          ?.length ||
        0,

      scoringFormat:
        settings
          ?.scoringProfile
          ?.format ||
        null,

      matchupProjection:
        Boolean(
          matchup &&
          matchup.myProjected !==
            null &&
          matchup
            .opponentProjected !==
            null
        ),

      playerProjections:
        roster.filter(
          function (player) {
            return (
              Number(
                player
                  .projectedPoints
              ) > 0
            );
          }
        ).length,

      complete:
        Boolean(
          leagueId &&
          leagueName &&
          teamId &&
          teamName &&
          roster.length &&
          standings.length &&
          schedule.length &&
          settings
            ?.scoringRules
            ?.length
        ),
    };

    /*
      ==============================================================
      FINAL SAFE CBS OBJECT
      ==============================================================
    */

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
          (
            standings.length ||
            null
          ),

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

        dataQuality,

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
    ================================================================
    PUBLIC API
    ================================================================
  */

  window.CBSBrowserConnector = {
    version:
      VERSION,

    isCbsFantasyPage,

    /*
      Synchronous roster-only capture.
    */
    capture,

    /*
      Full multi-page capture.
    */
    captureAll,

    /*
      Exposed for diagnostics/testing.
      All collectors remain READ ONLY.
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
