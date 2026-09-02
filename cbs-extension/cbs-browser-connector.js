/*
  THE INNER SANCTUM — cbs-browser-connector.js
  ------------------------------------------------
  Browser-assisted, READ-ONLY CBS Fantasy connector.

  VERSION 0.4.0

  DESIGN PRINCIPLE
  ------------------------------------------------
  Reliability before completeness.

  CBS already renders league information to an authenticated user.
  This connector collects only fantasy-football data CBS has already
  exposed to that user's browser.

  PROVEN CBS SURFACES
  ------------------------------------------------

  /teams
    - league identity
    - user's team identity
    - roster
    - CBS player IDs
    - actual player positions
    - NFL teams
    - active / reserve / injured status

  /standings/overall
    - CBS team IDs
    - team names
    - divisions
    - W/L/T
    - percentage
    - games back
    - streak
    - division record
    - points for
    - points against

  /schedule/team
    - week
    - opponent
    - opponent CBS team ID
    - home / away
    - result
    - resulting team record

  /rules
    - team count
    - division count
    - roster limits
    - starting lineup requirements
    - waiver / lineup policies
    - draft settings
    - scoring rules
    - derived scoring profile
    - playoff structure

  /scoring/preview
    - overall matchup projection
    - CBS player projections when CBS exposes a reliable player ID
      or an unambiguous two-player comparison container

  SECURITY
  ------------------------------------------------
  This connector:

    - DOES NOT collect CBS username/password
    - DOES NOT inspect browser cookies
    - DOES NOT return browser cookies
    - DOES NOT collect CBS access/session tokens
    - DOES NOT inspect Authorization headers
    - DOES NOT bypass CAPTCHA
    - DOES NOT change lineups
    - DOES NOT perform transactions
    - DOES NOT add/drop players
    - DOES NOT collect league entry fees
    - DOES NOT collect league email addresses

  All background requests are GET-only and remain on the user's
  current authenticated CBS Fantasy league origin.

  PUBLIC API
  ------------------------------------------------

    CBSBrowserConnector.capture()

      Basic current-page roster capture.

    await CBSBrowserConnector.captureAll()

      Full multi-page CBS league capture.
*/

(function () {
  "use strict";

  const VERSION = "0.4.0";

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

  function normalizeName(value) {
    return clean(value)
      .toLowerCase()
      .replace(/[’]/g, "'")
      .replace(/[^a-z0-9']/g, "");
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

  function parseFlexibleNumber(value) {
    const text = clean(value);

    const match =
      text.match(
        /-?(?:\d+(?:\.\d+)?|\.\d+)/
      );

    if (!match) {
      return null;
    }

    const n =
      Number(match[0]);

    return Number.isFinite(n)
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
    SAME-ORIGIN CBS FETCH
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
          credentials: "same-origin",
          cache: "no-store",

          headers: {
            Accept: "text/html",
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
      url: url.href,
      html,
      doc: parseHtml(html),
    };
  }

  /*
    ================================================================
    LEAGUE / TEAM IDENTITY
    ================================================================
  */

  function getSeasonFromDocument(doc) {
    const selects =
      [...doc.querySelectorAll(
        "select"
      )];

    for (const select of selects) {
      const selected =
        clean(
          select
            .selectedOptions?.[0]
            ?.textContent
        );

      if (/^20\d{2}$/.test(selected)) {
        return Number(selected);
      }
    }

    for (const script of doc.scripts) {
      const text =
        script.textContent || "";

      const match =
        text.match(
          /FantasyGlobalChatJson\.year\s*=\s*(\d{4})/
        );

      if (match) {
        return Number(
          match[1]
        );
      }
    }

    if (doc === document) {
      try {
        const year =
          Number(
            window
              .FantasyGlobalChatJson
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
        // Fall through.
      }
    }

    return new Date()
      .getFullYear();
  }

  function getLeagueNameFromDocument(doc) {
    const selectors = [
      ".team-info-name-league",
      ".nav-my-teams-league",
    ];

    for (const selector of selectors) {
      const value =
        clean(
          doc
            .querySelector(selector)
            ?.textContent
        );

      if (value) {
        return value;
      }
    }

    for (
      const row of
      doc.querySelectorAll("tr")
    ) {
      const cells =
        [...row.querySelectorAll(
          "th,td"
        )].map(
          function (cell) {
            return clean(
              cell.textContent
            );
          }
        );

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
          doc
            .querySelector(selector)
            ?.textContent
        );

      if (value) {
        return value;
      }
    }

    for (
      const row of
      doc.querySelectorAll("tr")
    ) {
      const text =
        clean(
          row.textContent
        );

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
        window
          .FantasyGlobalChatJson
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
      // Fall through.
    }

    return null;
  }

  /*
    ================================================================
    EXACT CBS PLAYER OBJECT EXTRACTION
    ================================================================

    Previous versions used a broad text window around each player ID.
    That could accidentally borrow metadata from the neighboring CBS
    player object.

    0.3.0 instead locates the exact:

        "PLAYER_ID": { ... }

    object and uses brace balancing to isolate that player's object
    before reading status/position/team fields.
  */

  function extractBalancedObject(
    text,
    objectStart
  ) {
    const braceStart =
      text.indexOf(
        "{",
        objectStart
      );

    if (braceStart < 0) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (
      let i = braceStart;
      i < text.length;
      i++
    ) {
      const ch =
        text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (ch === "\\") {
          escaped = true;
          continue;
        }

        if (ch === '"') {
          inString = false;
        }

        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{") {
        depth++;
        continue;
      }

      if (ch === "}") {
        depth--;

        if (depth === 0) {
          return text.slice(
            braceStart,
            i + 1
          );
        }
      }
    }

    return null;
  }

  function findExactEmbeddedPlayerObject(
    doc,
    playerId
  ) {
    const keyPattern =
      '"' +
      String(playerId) +
      '"';

    for (const script of doc.scripts) {
      const text =
        script.textContent || "";

      if (
        !text.includes(
          keyPattern
        )
      ) {
        continue;
      }

      let searchFrom = 0;

      while (true) {
        const keyIndex =
          text.indexOf(
            keyPattern,
            searchFrom
          );

        if (keyIndex < 0) {
          break;
        }

        const colonIndex =
          text.indexOf(
            ":",
            keyIndex +
              keyPattern.length
          );

        if (colonIndex < 0) {
          break;
        }

        const between =
          text.slice(
            keyIndex +
              keyPattern.length,
            colonIndex
          );

        if (
          between.trim() !==
          ""
        ) {
          searchFrom =
            keyIndex + 1;

          continue;
        }

        const objectText =
          extractBalancedObject(
            text,
            colonIndex
          );

        if (
          objectText &&
          objectText.includes(
            '"id"'
          ) &&
          objectText.includes(
            String(playerId)
          )
        ) {
          return objectText;
        }

        searchFrom =
          keyIndex + 1;
      }
    }

    return null;
  }

  function extractExactEmbeddedPlayerMeta(
    doc,
    playerId
  ) {
    const block =
      findExactEmbeddedPlayerObject(
        doc,
        playerId
      );

    if (!block) {
      return {
        status: null,
        position: "",
        team: "",
      };
    }

    const statusMatch =
      block.match(
        /"status"\s*:\s*"([^"]+)"/
      );

    const currPosMatch =
      block.match(
        /"currPos"\s*:\s*"([^"]+)"/
      );

    const teamMatches =
      [...block.matchAll(
        /"team"\s*:\s*"([^"]+)"/g
      )];

    const teamMatch =
      teamMatches.length
        ? teamMatches[
            teamMatches.length - 1
          ]
        : null;

    return {
      status:
        clean(
          statusMatch?.[1]
        ) || null,

      position:
        clean(
          currPosMatch?.[1]
        ),

      team:
        clean(
          teamMatch?.[1]
        ),
    };
  }

  /*
    ================================================================
    ROSTER COLLECTOR
    ================================================================

    IMPORTANT:

    Player identity comes from the rendered CBS roster row.

    Embedded CBS script metadata is NEVER allowed to overwrite:
      - player's name
      - rendered actual football position
      - rendered NFL team

    Embedded metadata is used primarily for roster status.
  */

  function getLiveRosterMap() {
    try {
      return (
        window
          .lineupBuilder
          ?.rosterMap
          ?.slot || {}
      );
    } catch (e) {
      return {};
    }
  }

  function findLiveRosterPlayer(
    rosterMap,
    row,
    playerId
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
        String(playerId)
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
            String(playerId)
          );
        }
      ) || {}
    );
  }

  function parseRenderedPositionAndTeam(
    row
  ) {
    const metadata =
      clean(
        row.querySelector(
          ".playerPositionAndTeam"
        )?.textContent
      );

    let position = "";
    let nflTeam = "";

    if (metadata) {
      const parts =
        metadata
          .split(/[•·]/)
          .map(clean)
          .filter(Boolean);

      if (parts[0]) {
        position =
          parts[0];
      }

      if (parts[1]) {
        nflTeam =
          parts[1];
      }
    }

    if (!position) {
      position =
        clean(
          row.querySelector(
            ".playerPosition"
          )?.textContent
        );
    }

    return {
      position,
      nflTeam,
    };
  }

  function extractRosterFromDocument(
    doc,
    useLiveRosterMap
  ) {
    const rosterMap =
      useLiveRosterMap
        ? getLiveRosterMap()
        : {};

    const roster = [];

    const seen =
      new Set();

    doc.querySelectorAll(
      "tr.playerRow"
    ).forEach(
      function (row) {
        const link =
          row.querySelector(
            'a.playerLink[href*="/players/playerpage/"]'
          );

        if (!link) {
          return;
        }

        const playerId =
          parsePlayerIdFromHref(
            link.href
          );

        if (
          !playerId ||
          seen.has(playerId)
        ) {
          return;
        }

        seen.add(
          playerId
        );

        /*
          The rendered CBS row is authoritative for identity.
        */

        const name =
          clean(
            link.textContent
          );

        if (!name) {
          return;
        }

        const rendered =
          parseRenderedPositionAndTeam(
            row
          );

        const livePlayer =
          useLiveRosterMap
            ? findLiveRosterPlayer(
                rosterMap,
                row,
                playerId
              )
            : {};

        const embedded =
          useLiveRosterMap
            ? {}
            : extractExactEmbeddedPlayerMeta(
                doc,
                playerId
              );

        /*
          Position:
          rendered player metadata first.

          CBS lineup-slot columns can display RB-WR-TE.
          If so, use exact CBS currPos when safely available.
        */

        let position =
          rendered.position;

        const exactPosition =
          clean(
            livePlayer
              ?.elig
              ?.currPos
          ) ||
          clean(
            embedded.position
          );

        if (
          (
            !position ||
            position.includes(
              "-"
            )
          ) &&
          exactPosition &&
          !exactPosition.includes(
            "-"
          )
        ) {
          position =
            exactPosition;
        }

        /*
          NFL team:
          rendered row first, exact CBS player object fallback.
        */

        let nflTeam =
          rendered.nflTeam;

        if (!nflTeam) {
          nflTeam =
            clean(
              livePlayer?.team
            ) ||
            clean(
              embedded.team
            );
        }

        /*
          Roster status:
          exact player-specific metadata only.
        */

        const status =
          clean(
            livePlayer?.status
          ) ||
          clean(
            embedded.status
          ) ||
          null;

        roster.push({
          cbsPlayerId:
            playerId,

          name,

          position,

          nflTeam,

          status,

          projectedPoints:
            0,
        });
      }
    );

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
        "No CBS roster players were found on the current page."
      );
    }

    return roster;
  }

  /*
    ================================================================
    STANDINGS
    ================================================================
  */

  function captureStandingsFromDocument(
    doc
  ) {
    const standings = [];

    let currentDivision =
      "";

    const seenTeamIds =
      new Set();

    function normalizeHeader(value) {
      return clean(value)
        .replace(/[.]/g, "")
        .replace(/\s+/g, "")
        .toUpperCase();
    }

    function getCellLabel(cell) {
      return normalizeHeader(
        cell.getAttribute(
          "data-label"
        ) ||
        cell.getAttribute(
          "aria-label"
        ) ||
        ""
      );
    }

    function parseRecord(value) {
      const text =
        clean(value);

      const match =
        text.match(
          /(?:^|\s)(\d+)\s*[-–—]\s*(\d+)(?:\s*[-–—]\s*(\d+))?(?:\s|$)/
        );

      if (!match) {
        return null;
      }

      return {
        wins:
          Number(match[1]),

        losses:
          Number(match[2]),

        ties:
          Number(match[3] || 0),
      };
    }

    function makeGrid(table) {
      const rows =
        [...table.querySelectorAll(
          "tr"
        )];

      const grid = [];

      rows.forEach(
        function (row, rowIndex) {
          if (!grid[rowIndex]) {
            grid[rowIndex] = [];
          }

          let columnIndex = 0;

          const cells =
            [...row.children].filter(
              function (child) {
                const tag =
                  child.tagName
                    ?.toLowerCase();

                return (
                  tag === "th" ||
                  tag === "td"
                );
              }
            );

          cells.forEach(
            function (cell) {
              while (
                grid[rowIndex][
                  columnIndex
                ] !== undefined
              ) {
                columnIndex++;
              }

              const rowSpan =
                Math.max(
                  1,
                  integerOrNull(
                    cell.getAttribute(
                      "rowspan"
                    )
                  ) || 1
                );

              const colSpan =
                Math.max(
                  1,
                  integerOrNull(
                    cell.getAttribute(
                      "colspan"
                    )
                  ) || 1
                );

              const entry = {
                text:
                  clean(
                    cell.textContent
                  ),

                label:
                  getCellLabel(
                    cell
                  ),

                cell,
              };

              for (
                let r = 0;
                r < rowSpan;
                r++
              ) {
                const targetRow =
                  rowIndex + r;

                if (!grid[targetRow]) {
                  grid[targetRow] = [];
                }

                for (
                  let c = 0;
                  c < colSpan;
                  c++
                ) {
                  grid[targetRow][
                    columnIndex + c
                  ] = entry;
                }
              }

              columnIndex +=
                colSpan;
            }
          );
        }
      );

      return {
        rows,
        grid,
      };
    }

    function findHeaderLabels(
      rows,
      grid,
      dataRowIndex
    ) {
      const labels = [];

      for (
        let rowIndex = 0;
        rowIndex < dataRowIndex;
        rowIndex++
      ) {
        const row =
          rows[rowIndex];

        if (!row) {
          continue;
        }

        const rowEntries =
          grid[rowIndex] || [];

        const headerLike =
          row.querySelectorAll(
            "th"
          ).length > 0;

        if (!headerLike) {
          continue;
        }

        rowEntries.forEach(
          function (entry, columnIndex) {
            const normalized =
              normalizeHeader(
                entry?.text
              );

            if (normalized) {
              labels[columnIndex] =
                normalized;
            }
          }
        );
      }

      return labels;
    }

    function valueFromAliases(
      values,
      aliases
    ) {
      for (const alias of aliases) {
        const normalized =
          normalizeHeader(alias);

        if (
          Object.prototype
            .hasOwnProperty.call(
              values,
              normalized
            )
        ) {
          return values[normalized];
        }
      }

      return "";
    }

    function parseStandingsTable(
      table
    ) {
      const built =
        makeGrid(table);

      const rows =
        built.rows;

      const grid =
        built.grid;

      let tableDivision =
        currentDivision;

      rows.forEach(
        function (row, rowIndex) {
          const directCells =
            [...row.querySelectorAll(
              ":scope > th, :scope > td"
            )];

          const directText =
            directCells.map(
              function (cell) {
                return clean(
                  cell.textContent
                );
              }
            );

          if (
            directText.length === 1 &&
            /division$/i.test(
              directText[0]
            )
          ) {
            tableDivision =
              directText[0]
                .replace(
                  /\s+division$/i,
                  ""
                )
                .trim();

            currentDivision =
              tableDivision;

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

          if (
            !teamId ||
            seenTeamIds.has(teamId)
          ) {
            return;
          }

          const rowEntries =
            grid[rowIndex] || [];

          const headerLabels =
            findHeaderLabels(
              rows,
              grid,
              rowIndex
            );

          const values = {};

          rowEntries.forEach(
            function (entry, columnIndex) {
              if (!entry) {
                return;
              }

              const ownLabel =
                entry.label;

              const headerLabel =
                headerLabels[
                  columnIndex
                ] || "";

              const label =
                ownLabel ||
                headerLabel;

              if (
                label &&
                !Object.prototype
                  .hasOwnProperty.call(
                    values,
                    label
                  )
              ) {
                values[label] =
                  entry.text;
              }
            }
          );

          const rowText =
            clean(
              row.textContent
            );

          const combinedRecord =
            parseRecord(
              valueFromAliases(
                values,
                [
                  "W-L-T",
                  "WLT",
                  "RECORD",
                  "REC",
                ]
              )
            ) ||
            parseRecord(
              rowText
            );

          let wins =
            integerOrNull(
              valueFromAliases(
                values,
                ["W", "WINS"]
              )
            );

          let losses =
            integerOrNull(
              valueFromAliases(
                values,
                ["L", "LOSSES"]
              )
            );

          let ties =
            integerOrNull(
              valueFromAliases(
                values,
                ["T", "TIES"]
              )
            );

          if (combinedRecord) {
            if (wins === null) {
              wins =
                combinedRecord.wins;
            }

            if (losses === null) {
              losses =
                combinedRecord.losses;
            }

            if (ties === null) {
              ties =
                combinedRecord.ties;
            }
          }

          const percentage =
            numberOrNull(
              valueFromAliases(
                values,
                [
                  "PCT",
                  "PCT%",
                  "WIN%",
                  "WINPCT",
                ]
              )
            );

          const gamesBack =
            numberOrNull(
              valueFromAliases(
                values,
                ["GB", "GBACK"]
              )
            );

          const streak =
            clean(
              valueFromAliases(
                values,
                ["STREAK", "STRK"]
              )
            ) || null;

          const divisionRecord =
            clean(
              valueFromAliases(
                values,
                [
                  "DIV",
                  "DIVISION",
                  "DIVREC",
                  "DIVRECORD",
                ]
              )
            ) || null;

          const pointsFor =
            numberOrNull(
              valueFromAliases(
                values,
                [
                  "PF",
                  "POINTSFOR",
                  "PTSFOR",
                  "POINTSF",
                ]
              )
            );

          const pointsAgainst =
            numberOrNull(
              valueFromAliases(
                values,
                [
                  "PA",
                  "POINTSAGAINST",
                  "PTSAGAINST",
                  "POINTSA",
                ]
              )
            );

          let weeks =
            integerOrNull(
              valueFromAliases(
                values,
                [
                  "WKS",
                  "WK",
                  "WEEKS",
                  "GP",
                  "G",
                ]
              )
            );

          const recordParsed =
            wins !== null &&
            losses !== null;

          if (
            ties === null &&
            recordParsed
          ) {
            ties = 0;
          }

          if (
            weeks === null &&
            recordParsed
          ) {
            weeks =
              wins +
              losses +
              (ties || 0);
          }

          const scoringParsed =
            pointsFor !== null ||
            pointsAgainst !== null;

          standings.push({
            teamId,

            teamName:
              clean(
                teamLink.textContent
              ),

            division:
              tableDivision,

            wins,

            losses,

            ties,

            percentage,

            gamesBack,

            streak,

            divisionRecord,

            weeks,

            pointsFor,

            back:
              numberOrNull(
                valueFromAliases(
                  values,
                  ["BACK"]
                )
              ),

            pointsAgainst,

            recordParsed,

            scoringParsed,
          });

          seenTeamIds.add(teamId);
        }
      );
    }

    const tables =
      [...doc.querySelectorAll(
        "table"
      )];

    tables.forEach(
      parseStandingsTable
    );

    /*
      Fallback for unusual CBS markup where standings rows are not inside
      a normal table. Identity is still captured, but missing numeric data
      remains null rather than being silently manufactured as zero.
    */

    if (!standings.length) {
      doc.querySelectorAll(
        "tr"
      ).forEach(
        function (row) {
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

          if (
            !teamId ||
            seenTeamIds.has(teamId)
          ) {
            return;
          }

          const record =
            parseRecord(
              row.textContent
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
              record?.wins ??
              null,

            losses:
              record?.losses ??
              null,

            ties:
              record?.ties ??
              null,

            percentage:
              null,

            gamesBack:
              null,

            streak:
              null,

            divisionRecord:
              null,

            weeks:
              record
                ? record.wins +
                  record.losses +
                  record.ties
                : null,

            pointsFor:
              null,

            back:
              null,

            pointsAgainst:
              null,

            recordParsed:
              Boolean(record),

            scoringParsed:
              false,
          });

          seenTeamIds.add(teamId);
        }
      );
    }

    return standings;
  }

  /*
    ================================================================
    SCHEDULE
    ================================================================
  */

  function captureScheduleFromDocument(
    doc
  ) {
    const schedule = [];

    doc.querySelectorAll(
      "tr"
    ).forEach(
      function (row) {
        const cells =
          [...row.querySelectorAll(
            "th,td"
          )].map(
            function (cell) {
              return clean(
                cell.textContent
              );
            }
          );

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

        const rawOpponent =
          clean(
            cells[1]
          );

        schedule.push({
          week,

          opponentId:
            parseTeamIdFromHref(
              opponentLink.href
            ),

          opponentName:
            clean(
              opponentLink.textContent
            ),

          homeAway:
            rawOpponent
              .startsWith("@")
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
      }
    );

    return schedule;
  }

  /*
    ================================================================
    RULE / TABLE HELPERS
    ================================================================
  */

  function getTableRows(table) {
    return [
      ...table.querySelectorAll(
        "tr"
      ),
    ]
      .map(
        function (row) {
          const cells =
            [...row.querySelectorAll(
              "th,td"
            )].map(
              function (cell) {
                return clean(
                  cell.textContent
                );
              }
            );

          return cells.some(Boolean)
            ? cells
            : null;
        }
      )
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
          /^(offensive|defensive)$/i
            .test(first) &&
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

  /*
    Handles:
      4 points
      -2 points
      .5 points
      0.5 points
  */

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
        /^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*points?/i
      );

    return match
      ? Number(
          match[1]
        )
      : null;
  }

  /*
    Handles:
      0+ PaYds = .05 points for every 1 PaYd
      0+ RuYds = .1 points for every 1 RuYd
  */

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
        /=\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*points?\s+for\s+every\s+1\s+\w*yd/i
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
      receptionPoints === 0
    ) {
      format =
        "standard";
    }

    /*
      Missing reception rule does NOT automatically mean standard.
      It means we have insufficient evidence, so keep "custom".
    */

    const passingYardPoints =
      parsePerYardPoints(
        getScoringRule(
          scoringRules,
          "PaYd"
        )?.setting
      );

    const rushingYardPoints =
      parsePerYardPoints(
        getScoringRule(
          scoringRules,
          "RuYd"
        )?.setting
      );

    const receivingYardPoints =
      parsePerYardPoints(
        getScoringRule(
          scoringRules,
          "ReYd"
        )?.setting
      );

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

    const rowsByTable =
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

    rowsByTable.forEach(
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
          League identity.
          Do NOT retain fee or league email.
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
          Roster configuration.
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

          // Root-cause fix: this table has FIVE columns per position
          // row -- [Position, Active Min, Starters, Active Max,
          // Total Players] -- not the four the code previously
          // assumed. The old fixed reads (cells[1]/[2]/[3]) landed on
          // CBS's own near-always-zero "Active Min" column and its
          // "Starters" column respectively, so our activeMin field
          // ended up with 0 and our activeMax field ended up holding
          // the real starter count instead. Column indices are
          // resolved from the table's own header row by name first
          // (robust to CBS reordering its columns); the indices below
          // are used only as a fallback when header text can't be
          // matched confidently, and reflect the real column order
          // confirmed against a known league's captured settings
          // (Position, Active Min, Starters, Active Max, Total
          // Players) -- not an invented default.
          let starterColumnIndex =
            null;

          let activeMaxColumnIndex =
            null;

          let totalPlayersColumnIndex =
            null;

          rows.forEach(
            function (cells) {
              // TEMPORARY DIAGNOSTIC (remove once the real CBS table
              // shape is confirmed): logs every row in this whole
              // table unconditionally, before any of the existing
              // branches below run or return early. This does not
              // assume "Position" is the correct header label to
              // look for -- if that match below never fires, this
              // still shows exactly what each row's real cells are.
              console.log(
                "[Inner Sanctum CBS Diagnostic] Roster/rules table row -- length:",
                cells.length,
                "cells:",
                cells
              );

              if (
                cells[0] ===
                "Position"
              ) {
                mode =
                  "position";

                cells.forEach(
                  function (
                    headerCell,
                    headerIndex
                  ) {
                    const headerText =
                      String(
                        headerCell ||
                        ""
                      )
                        .trim()
                        .toLowerCase();

                    if (
                      headerText ===
                      "starters"
                    ) {
                      starterColumnIndex =
                        headerIndex;
                    } else if (
                      headerText ===
                      "active max"
                    ) {
                      activeMaxColumnIndex =
                        headerIndex;
                    } else if (
                      headerText ===
                      "total players"
                    ) {
                      totalPlayersColumnIndex =
                        headerIndex;
                    }
                  }
                );

                // TEMPORARY DIAGNOSTIC (remove once the real CBS
                // table shape is confirmed): logs exactly what the
                // header row and resolved column indices are, with
                // no effect on parsing behavior below.
                console.log(
                  "[Inner Sanctum CBS Diagnostic] Position table header cells (in order):",
                  cells
                );

                console.log(
                  "[Inner Sanctum CBS Diagnostic] Resolved column indices -- starters:",
                  starterColumnIndex,
                  "activeMax:",
                  activeMaxColumnIndex,
                  "totalPlayers:",
                  totalPlayersColumnIndex,
                  "(null means header text did not match; the fallback indices 2/3/4 would be used instead)"
                );

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
                cells.length ===
                1
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
                cells.length >=
                  3
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
                cells.length >=
                  5
              ) {
                const resolvedStarterIndex =
                  starterColumnIndex !==
                  null
                    ? starterColumnIndex
                    : 2;

                const resolvedActiveMaxIndex =
                  activeMaxColumnIndex !==
                  null
                    ? activeMaxColumnIndex
                    : 3;

                const resolvedTotalPlayersIndex =
                  totalPlayersColumnIndex !==
                  null
                    ? totalPlayersColumnIndex
                    : 4;

                const totalPlayersCell =
                  cells[
                    resolvedTotalPlayersIndex
                  ];

                settings
                  .roster
                  .positions[
                    cells[0]
                  ] = {
                    activeMin:
                      integerOrNull(
                        cells[
                          resolvedStarterIndex
                        ]
                      ),

                    activeMax:
                      integerOrNull(
                        cells[
                          resolvedActiveMaxIndex
                        ]
                      ),

                    rosterTotal:
                      totalPlayersCell ===
                      "No Limit"
                        ? null
                        : integerOrNull(

                            totalPlayersCell
                          ),
                  };
              }
            }
          );

          return;
        }

        /*
          Scoring.
        */

        if (
          flat.includes(
            "passing td"
          ) &&
          flat.includes(
            "reception"
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

        if (
          map[
            "Draft Format"
          ]
        ) {
          settings.draft =
            map;

          return;
        }

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
    CBS SCORING PREVIEW
    ================================================================

    0.3.0 intentionally refuses ambiguous player associations.

    If a comparison container cannot be tied to EXACTLY two unique
    CBS player links, those individual scores are left unassigned.

    This prevents bad fantasy data from entering SAGE.
  */

  function getUniquePlayerLinks(
    node
  ) {
    const output = [];

    const seen =
      new Set();

    node
      .querySelectorAll(
        'a[href*="/players/playerpage/"]'
      )
      .forEach(
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

          output.push({
            cbsPlayerId:
              id,

            name:
              clean(
                link.textContent
              ),
          });
        }
      );

    return output;
  }

  function findExactPreviewPlayerPair(
    table
  ) {
    let node =
      table.parentElement;

    for (
      let depth = 0;
      depth < 6 &&
      node;
      depth++
    ) {
      const players =
        getUniquePlayerLinks(
          node
        );

      if (
        players.length ===
        2
      ) {
        return players;
      }

      /*
        More than two means the container is too broad.
        Do not guess.
      */

      if (
        players.length > 2
      ) {
        return [];
      }

      node =
        node.parentElement;
    }

    return [];
  }

  function getUniqueTeamLinks(
    node
  ) {
    const output = [];

    const seen =
      new Set();

    node
      .querySelectorAll(
        'a[href*="/teams/"]'
      )
      .forEach(
        function (link) {
          const id =
            parseTeamIdFromHref(
              link.href
            );

          if (
            !id ||
            seen.has(id)
          ) {
            return;
          }

          seen.add(id);

          output.push({
            teamId:
              id,

            teamName:
              clean(
                link.textContent
              ),
          });
        }
      );

    return output;
  }

  function findExactPreviewTeamPair(
    table
  ) {
    let node =
      table.parentElement;

    for (
      let depth = 0;
      depth < 7 &&
      node;
      depth++
    ) {
      const teams =
        getUniqueTeamLinks(
          node
        );

      if (
        teams.length === 2
      ) {
        return teams;
      }

      if (
        teams.length > 2
      ) {
        return [];
      }

      node =
        node.parentElement;
    }

    return [];
  }

  function parsePreviewPlayerText(
    text
  ) {
    const value =
      clean(text);

    const match =
      value.match(
        /^(.*?)(QB|RB|WR|TE|K|DST)\s*[•·]\s*([A-Z]{2,3})$/i
      );

    if (!match) {
      return {
        name:
          value,

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

    const projectionById =
      new Map();

    const projectionByName =
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

        const first =
          rows[0];

        /*
          Graphical CBS comparison:
            105 | EVEN | 128
        */

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

          comparisonScores.push({
            tableIndex,
            left,
            right,
          });

          if (!teamProjection) {
            const teams =
              findExactPreviewTeamPair(
                table
              );

            teamProjection = {
              leftProjected:
                left,

              rightProjected:
                right,

              leftTeamId:
                teams[0]
                  ?.teamId ||
                null,

              leftTeamName:
                teams[0]
                  ?.teamName ||
                "",

              rightTeamId:
                teams[1]
                  ?.teamId ||
                null,

              rightTeamName:
                teams[1]
                  ?.teamName ||
                "",
            };

            return;
          }

          /*
            Individual comparison:
            use only if exactly two CBS player IDs are found.
          */

          const players =
            findExactPreviewPlayerPair(
              table
            );

          if (
            players.length === 2
          ) {
            projectionById.set(
              players[0]
                .cbsPlayerId,
              {
                cbsPlayerId:
                  players[0]
                    .cbsPlayerId,

                name:
                  players[0]
                    .name,

                projectedPoints:
                  left,

                source:
                  "starter-comparison",
              }
            );

            projectionById.set(
              players[1]
                .cbsPlayerId,
              {
                cbsPlayerId:
                  players[1]
                    .cbsPlayerId,

                name:
                  players[1]
                    .name,

                projectedPoints:
                  right,

                source:
                  "starter-comparison",
              }
            );
          }
        }

        /*
          Normal CBS player projection table:
            PLAYER | NEWS | MATCHUP | PTS
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
          !header.includes(
            "PLAYER"
          ) ||
          !header.includes(
            "PTS"
          )
        ) {
          return;
        }

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
              const points =
                numberOrNull(
                  cells[
                    pointsIndex
                  ]
                );

              if (
                points === null
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

              const playerId =
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

              if (!parsed.name) {
                return;
              }

              const projection = {
                cbsPlayerId:
                  playerId,

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
                  points,

                source:
                  "player-table",
              };

              if (playerId) {
                projectionById.set(
                  playerId,
                  projection
                );
              } else {
                projectionByName.set(
                  normalizeName(
                    parsed.name
                  ),
                  projection
                );
              }
            }
          );
      }
    );

    return {
      teamProjection,

      comparisonScores,

      playerProjectionsById:
        [
          ...projectionById
            .values(),
        ],

      playerProjectionsByName:
        [
          ...projectionByName
            .values(),
        ],
    };
  }

  /*
    ================================================================
    BASIC CAPTURE
    ================================================================
  */

  function capture() {
    assertCbsFantasyPage();

    return {
      league: {
        id:
          getLeagueId(),

        name:
          getLeagueNameFromDocument(
            document
          ),

        season:
          getSeasonFromDocument(
            document
          ),
      },

      team: {
        id:
          getTeamIdFromLivePage(),

        name:
          getTeamNameFromDocument(
            document
          ),

        wins:
          0,

        losses:
          0,

        ties:
          0,

        rank:
          null,
      },

      roster:
        captureCurrentRoster(),

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
    FULL CAPTURE
    ================================================================
  */

  async function captureAll() {
    assertCbsFantasyPage();

    const leagueId =
      getLeagueId();

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
      ROSTER
    */

    let roster = [];

    if (
      location.pathname ===
        "/teams" ||
      /^\/teams\/\d+\/?$/i
        .test(
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
      STANDINGS
    */

    const standings =
      standingsPage
        ? captureStandingsFromDocument(
            standingsPage.doc
          )
        : [];

    /*
      SCHEDULE
    */

    const schedule =
      schedulePage
        ? captureScheduleFromDocument(
            schedulePage.doc
          )
        : [];

    /*
      RULES
    */

    const settings =
      rulesPage
        ? captureRulesFromDocument(
            rulesPage.doc
          )
        : null;

    /*
      PREVIEW
    */

    const projections =
      previewPage
        ? capturePreviewFromDocument(
            previewPage.doc
          )
        : null;

    /*
      LEAGUE IDENTITY
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
      USER TEAM IDENTITY
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
              normalizeName(
                team.teamName
              ) ===
              normalizeName(
                teamName
              )
            );
          }
        );

      if (found) {
        teamId =
          found.teamId;
      }
    }

    /*
      USER STANDING
    */

    const myStanding =
      standings.find(
        function (team) {
          if (
            teamId &&
            String(
              team.teamId
            ) ===
              String(teamId)
          ) {
            return true;
          }

          return (
            teamName &&
            normalizeName(
              team.teamName
            ) ===
            normalizeName(
              teamName
            )
          );
        }
      ) || null;

    /*
      Do not manufacture preseason ranks.
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

    let standingRank =
      null;

    if (
      myStanding &&
      seasonHasResults
    ) {
      const ordered =
        standings
          .slice()
          .sort(
            function (a, b) {
              const pctDiff =
                (
                  b.percentage ??
                  0
                ) -
                (
                  a.percentage ??
                  0
                );

              if (pctDiff) {
                return pctDiff;
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
          );

      const index =
        ordered.findIndex(
          function (team) {
            return (
              String(
                team.teamId
              ) ===
              String(
                myStanding.teamId
              )
            );
          }
        );

      standingRank =
        index >= 0
          ? index + 1
          : null;
    }

    /*
      PLAYER PROJECTION JOIN

      Exact CBS player ID first.
      Normalized name only when CBS gave no ID.

      Never let projection data alter player identity/position/team.
    */

    if (
      roster.length &&
      projections
    ) {
      const byId =
        new Map();

      const byName =
        new Map();

      projections
        .playerProjectionsById
        ?.forEach(
          function (projection) {
            if (
              projection
                .cbsPlayerId
            ) {
              byId.set(
                String(
                  projection
                    .cbsPlayerId
                ),
                projection
              );
            }
          }
        );

      projections
        .playerProjectionsByName
        ?.forEach(
          function (projection) {
            byName.set(
              normalizeName(
                projection.name
              ),
              projection
            );
          }
        );

      roster =
        roster.map(
          function (player) {
            const projection =
              byId.get(
                String(
                  player.cbsPlayerId
                )
              ) ||
              byName.get(
                normalizeName(
                  player.name
                )
              );

            if (!projection) {
              return player;
            }

            return {
              ...player,

              projectedPoints:
                projection
                  .projectedPoints,
            };
          }
        );
    }

    /*
      MATCHUP

      Use CBS team IDs whenever preview page exposes a reliable
      two-team comparison container.

      If team identity cannot be established safely, matchup stays
      null rather than guessing.
    */

    let matchup =
      null;

    const teamProjection =
      projections
        ?.teamProjection;

    if (
      teamProjection &&
      teamId
    ) {
      const isLeft =
        String(
          teamProjection
            .leftTeamId ??
          ""
        ) ===
        String(teamId);

      const isRight =
        String(
          teamProjection
            .rightTeamId ??
          ""
        ) ===
        String(teamId);

      if (isLeft) {
        matchup = {
          opponentName:
            teamProjection
              .rightTeamName,

          opponentId:
            teamProjection
              .rightTeamId,

          myProjected:
            teamProjection
              .leftProjected,

          opponentProjected:
            teamProjection
              .rightProjected,

          winProbability:
            null,
        };
      } else if (isRight) {
        matchup = {
          opponentName:
            teamProjection
              .leftTeamName,

          opponentId:
            teamProjection
              .leftTeamId,

          myProjected:
            teamProjection
              .rightProjected,

          opponentProjected:
            teamProjection
              .leftProjected,

          winProbability:
            null,
        };
      }
    }

    /*
      WARNINGS
    */

    const labels = [
      "roster",
      "standings",
      "schedule",
      "rules",
      "scoring preview",
    ];

    const warnings =
      [];

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
      DATA QUALITY
    */

    const uniqueRosterIds =
      new Set(
        roster.map(
          function (player) {
            return (
              player
                .cbsPlayerId
            );
          }
        )
      );

    const duplicateRosterIds =
      uniqueRosterIds.size !==
      roster.length;

    const scoringFormat =
      settings
        ?.scoringProfile
        ?.format ||
      null;

    const standingsRecordCount =
      standings.filter(
        function (team) {
          return (
            team.recordParsed ===
            true
          );
        }
      ).length;

    const standingsScoringCount =
      standings.filter(
        function (team) {
          return (
            team.scoringParsed ===
            true
          );
        }
      ).length;

    if (
      standings.length &&
      standingsRecordCount <
        standings.length
    ) {
      warnings.push(
        "CBS standings team identity was captured, but record fields were not parsed for every team."
      );
    }

    if (
      standings.length &&
      standingsScoringCount <
        standings.length
    ) {
      warnings.push(
        "CBS standings team identity was captured, but PF/PA fields were not parsed for every team."
      );
    }

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

      duplicateRosterIds,

      rosterStatuses:
        roster.filter(
          function (player) {
            return Boolean(
              player.status
            );
          }
        ).length,

      standings:
        standings.length > 0,

      standingsCount:
        standings.length,

      standingsRecordCount,

      standingsScoringCount,

      standingsRecordCoverage:
        standings.length
          ? standingsRecordCount /
            standings.length
          : 0,

      standingsScoringCoverage:
        standings.length
          ? standingsScoringCount /
            standings.length
          : 0,

      schedule:
        schedule.length > 0,

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

      scoringFormat,

      matchupProjection:
        Boolean(
          matchup
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
          !duplicateRosterIds &&
          standings.length &&
          schedule.length &&
          settings
            ?.scoringRules
            ?.length
        ),
    };

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

    capture,

    captureAll,

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
