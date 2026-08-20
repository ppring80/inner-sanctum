/*
  THE INNER SANCTUM — cbs-browser-connector.js
  ------------------------------------------------
  READ-ONLY browser-assisted CBS Fantasy connector.

  PURPOSE
  -------
  Extracts safe fantasy league information that CBS has already
  rendered into an authenticated user's CBS Fantasy league page.

  This connector:

    - DOES NOT collect CBS usernames or passwords
    - DOES NOT read browser cookies
    - DOES NOT read authorization headers
    - DOES NOT store CBS access/session tokens
    - DOES NOT attempt to bypass CAPTCHA
    - DOES NOT perform CBS transactions
    - DOES NOT change lineups

  Initial scope is READ ONLY.

  Output contract is designed for:

      normalizeLeagueData("cbs", rawData)

  in provider-adapters.js.

  Expected use:

      const raw = CBSBrowserConnector.capture();

      const normalized =
        normalizeLeagueData("cbs", raw);

  NOTE:
  This script is intended to execute in the context of an already
  authenticated CBS Fantasy Football league page such as:

      https://{league}.football.cbssports.com/teams
*/

(function () {
  "use strict";

  function clean(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getLeagueId() {
    const hostname = location.hostname || "";

    const match = hostname.match(
      /^([^.]+)\.football\.cbssports\.com$/i
    );

    return match ? match[1] : "";
  }

  function getLeagueName() {
    return clean(
      document.querySelector(
        ".team-info-name-league"
      )?.textContent ||
      document.querySelector(
        ".nav-my-teams-league"
      )?.textContent
    );
  }

  function getTeamName() {
    return clean(
      document.querySelector(
        ".team-info-name-owner"
      )?.textContent ||
      document.querySelector(
        ".nav-my-teams-name"
      )?.textContent
    );
  }

  function getTeamId() {
    /*
      Best/easiest source on the CBS lineup page.
    */

    const inputValue =
      document.querySelector(
        'input[name="team"]'
      )?.value;

    if (inputValue) {
      return clean(inputValue);
    }

    /*
      Fallback:
      CBS frequently embeds the user's team identity
      in FantasyGlobalChatJson.

      We deliberately read ONLY team metadata.
      We do NOT expose or return auth/token information.
    */

    try {
      const team =
        window.FantasyGlobalChatJson
          ?.userAuth
          ?.attrib
          ?.team;

      if (team?.id) {
        return clean(team.id);
      }
    } catch (e) {
      // Safe fallback below.
    }

    return null;
  }

  function getSeason() {
    /*
      CBS currently exposes the fantasy season in
      FantasyGlobalChatJson.year.
    */

    try {
      const year =
        Number(
          window.FantasyGlobalChatJson?.year
        );

      if (
        Number.isInteger(year) &&
        year > 2000 &&
        year < 2100
      ) {
        return year;
      }
    } catch (e) {
      // Continue to script-text fallback.
    }

    /*
      Fallback for CBS pages where the object isn't
      available globally but its initialization script
      exists in the page.
    */

    for (const script of document.scripts) {
      const text =
        script.textContent || "";

      const match = text.match(
        /FantasyGlobalChatJson\.year\s*=\s*(\d{4})/
      );

      if (match) {
        return Number(match[1]);
      }
    }

    return new Date().getFullYear();
  }

  function getRosterMap() {
    /*
      CBS LineupBuilder contains structured roster
      information keyed by lineup slot/player.

      This object does contain useful player metadata,
      but we intentionally extract ONLY non-sensitive
      roster fields.
    */

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
    /*
      CBS sometimes indexes roster data by row/slot
      rather than directly by player ID.
    */

    if (row?.id && rosterMap[row.id]) {
      const candidate =
        rosterMap[row.id];

      if (
        String(candidate?.id ?? "") ===
        String(cbsPlayerId)
      ) {
        return candidate;
      }
    }

    /*
      Fall back to finding the object by CBS player ID.
    */

    return (
      Object.values(rosterMap).find(
        function (player) {
          return (
            String(player?.id ?? "") ===
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
      IMPORTANT:
      playerData.pos may represent the CURRENT LINEUP SLOT,
      such as RB-WR-TE / FLEX.

      We want the player's actual fantasy position.

      CBS's elig.currPos is therefore preferred.
    */

    const eligibilityPosition =
      clean(
        playerData
          ?.elig
          ?.currPos
      );

    if (
      eligibilityPosition &&
      !eligibilityPosition.includes("-")
    ) {
      return eligibilityPosition;
    }

    /*
      CBS renders metadata like:

        QB • JAC
        RB • MIA
        WR • CAR

      This is a strong fallback.
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
      Table position is another fallback.
    */

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

    /*
      Last resort.
    */

    return clean(
      playerData?.pos
    );
  }

  function getNflTeam(
    row,
    playerData
  ) {
    const structuredTeam =
      clean(playerData?.team);

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

  function extractRoster() {
    const rosterMap =
      getRosterMap();

    const roster = [];

    const seen =
      new Set();

    document
      .querySelectorAll(
        "tr.playerRow"
      )
      .forEach(function (row) {
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

        /*
          Ignore anything that doesn't resolve to
          an actual player/entity.
        */

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

          /*
            CBS roster status examples observed:

              A  = Active roster
              RS = Reserve

            Preserve CBS status here.
            Translation can happen later if needed.
          */

          status:
            clean(
              playerData?.status
            ) || null,

          projectedPoints: 0,
        });
      });

    return roster;
  }

  function isCbsFantasyPage() {
    return (
      /\.football\.cbssports\.com$/i
        .test(location.hostname)
    );
  }

  function capture() {
    if (!isCbsFantasyPage()) {
      throw new Error(
        "CBSBrowserConnector must run on an authenticated CBS Fantasy Football league page."
      );
    }

    const leagueId =
      getLeagueId();

    const leagueName =
      getLeagueName();

    const teamId =
      getTeamId();

    const teamName =
      getTeamName();

    const season =
      getSeason();

    const roster =
      extractRoster();

    if (!leagueId) {
      throw new Error(
        "Could not determine CBS league ID."
      );
    }

    if (!teamName) {
      throw new Error(
        "Could not determine the connected CBS fantasy team."
      );
    }

    if (!roster.length) {
      throw new Error(
        "No CBS roster players were found on this page."
      );
    }

    return {
      league: {
        id: leagueId,
        name: leagueName,
        season,
      },

      team: {
        id: teamId,
        name: teamName,

        /*
          Standings data will be added when the
          standings collector is implemented.
        */

        wins: 0,
        losses: 0,
        ties: 0,
        rank: null,
      },

      roster,

      /*
        Matchup collector comes later.
      */

      matchup: null,

      /*
        Safe connection metadata.

        No credentials/tokens are returned.
      */

      meta: {
        provider: "cbs",
        connectionMode:
          "browser-assisted",
        readOnly: true,
        capturedAt:
          new Date().toISOString(),
        sourceHost:
          location.hostname,
      },
    };
  }

  /*
    PUBLIC API
  */

  window.CBSBrowserConnector = {
    capture,

    isCbsFantasyPage,

    version: "0.1.0",
  };
})();
