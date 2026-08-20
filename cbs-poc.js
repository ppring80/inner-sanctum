/*
  THE INNER SANCTUM — cbs-poc.js
  -------------------------------------------
  CBS browser-handoff proof of concept.

  PURPOSE
  -------------------------------------------
  Prove the complete customer-side CBS flow:

    1. Inner Sanctum opens CBS in a separate tab/window.
    2. Customer signs into CBS normally.
    3. Customer opens their CBS Fantasy Football league.
    4. Customer clicks the Inner Sanctum CBS bookmark.
    5. This script loads the proven production
       cbs-browser-connector.js.
    6. CBSBrowserConnector.captureAll() collects the sanitized,
       READ-ONLY fantasy league package.
    7. The sanitized capture is sent directly back to the
       Inner Sanctum opener window with window.postMessage().
    8. connect-league.html receives the message and hands it to:

         window.receiveCbsConnection(captured)

    9. LeagueConnection stores the connected CBS league context.

  SECURITY
  -------------------------------------------
  This script:

    - does NOT collect CBS username/password
    - does NOT read/export browser cookies
    - does NOT export CBS session tokens
    - does NOT bypass CAPTCHA
    - does NOT modify CBS data
    - does NOT submit lineups
    - does NOT add/drop players
    - does NOT submit waivers
    - does NOT perform trades
    - is READ ONLY

  DATA TRANSPORT
  -------------------------------------------
  The captured fantasy-league object is sent only to the
  Inner Sanctum browser window that opened CBS.

  This version does NOT require the CBS ingest endpoint for the
  normal direct browser handoff.

  NETWORK BEHAVIOR
  -------------------------------------------
  GET:

    https://theinnersanctum.xyz/cbs-browser-connector.js

  The CBS fantasy capture itself remains inside the user's browser
  until it is sent directly to the originating Inner Sanctum tab
  through window.postMessage().
*/

(async function () {
  "use strict";

  /*
    ================================================================
    CONSTANTS
    ================================================================
  */

  const PREFIX =
    "[Inner Sanctum CBS Connect]";

  const PANEL_ID =
    "inner-sanctum-cbs-poc";

  const CONNECTOR_URL =
    "https://theinnersanctum.xyz/cbs-browser-connector.js";

  const MESSAGE_TYPE =
    "INNER_SANCTUM_CBS_CAPTURE_RESULT";

  const DISCOVERY_MESSAGE_TYPE =
    "INNER_SANCTUM_CBS_DISCOVERY_RESULT";

  const ALLOWED_SANCTUM_ORIGINS =
    new Set([
      "https://theinnersanctum.xyz",
      "https://www.theinnersanctum.xyz",
    ]);


  /*
    ================================================================
    UI HELPERS
    ================================================================
  */

  function removeExistingPanel() {
    const existing =
      document.getElementById(
        PANEL_ID
      );

    if (existing) {
      existing.remove();
    }
  }


  function createPanel() {
    removeExistingPanel();

    const panel =
      document.createElement(
        "div"
      );

    panel.id =
      PANEL_ID;

    panel.style.cssText = [
      "position:fixed",
      "top:20px",
      "right:20px",
      "z-index:2147483647",
      "width:440px",
      "max-width:calc(100vw - 40px)",
      "max-height:calc(100vh - 40px)",
      "overflow:auto",
      "background:#111",
      "color:#fff",
      "border:2px solid #d4af37",
      "border-radius:12px",
      "padding:18px",
      "box-shadow:0 12px 40px rgba(0,0,0,.45)",
      "font-family:Arial,sans-serif",
      "font-size:14px",
      "line-height:1.45"
    ].join(";");

    const heading =
      document.createElement(
        "div"
      );

    heading.style.cssText = [
      "font-size:18px",
      "font-weight:700",
      "margin-bottom:10px",
      "color:#d4af37"
    ].join(";");

    const body =
      document.createElement(
        "div"
      );

    body.style.cssText = [
      "white-space:pre-wrap"
    ].join(";");

    const buttons =
      document.createElement(
        "div"
      );

    buttons.style.cssText = [
      "margin-top:14px",
      "display:flex",
      "gap:8px",
      "flex-wrap:wrap"
    ].join(";");

    const statusArea =
      document.createElement(
        "div"
      );

    statusArea.style.cssText = [
      "margin-top:12px"
    ].join(";");

    panel.appendChild(
      heading
    );

    panel.appendChild(
      body
    );

    panel.appendChild(
      buttons
    );

    panel.appendChild(
      statusArea
    );

    document.body.appendChild(
      panel
    );

    return {
      panel,
      heading,
      body,
      buttons,
      statusArea
    };
  }


  function setPanelState(
    ui,
    title,
    message,
    type = "normal"
  ) {
    ui.heading.textContent =
      title;

    ui.body.textContent =
      message;

    if (
      type ===
      "error"
    ) {
      ui.heading.style.color =
        "#ff6b6b";
    } else if (
      type ===
      "success"
    ) {
      ui.heading.style.color =
        "#d4af37";
    } else {
      ui.heading.style.color =
        "#d4af37";
    }
  }


  function addStatusBox(
    ui,
    text,
    type = "success"
  ) {
    const box =
      document.createElement(
        "div"
      );

    const isError =
      type ===
      "error";

    box.style.cssText = [
      "margin-top:10px",
      "padding:10px",
      "border-radius:7px",
      isError
        ? "background:#3a1717"
        : "background:#16351f",
      isError
        ? "color:#ffc1c1"
        : "color:#b8efc5",
      "font-size:12px",
      "white-space:pre-wrap"
    ].join(";");

    box.textContent =
      text;

    ui.statusArea.appendChild(
      box
    );

    return box;
  }


  function createButton(
    label,
    mode = "primary"
  ) {
    const button =
      document.createElement(
        "button"
      );

    button.textContent =
      label;

    const primary =
      mode ===
      "primary";

    button.style.cssText = [
      "padding:9px 14px",
      "border-radius:7px",
      primary
        ? "border:0"
        : "border:1px solid #d4af37",
      primary
        ? "background:#d4af37"
        : "background:#111",
      primary
        ? "color:#111"
        : "color:#d4af37",
      "font-weight:700",
      "cursor:pointer"
    ].join(";");

    return button;
  }


  /*
    ================================================================
    CBS PAGE VALIDATION
    ================================================================
  */

  function isLeagueSubdomain() {
    const hostname =
      String(
        window.location.hostname ||
        ""
      ).toLowerCase();

    return (
      hostname ===
        "football.cbssports.com" ||
      hostname.endsWith(
        ".football.cbssports.com"
      )
    );
  }


  function assertCbsPage() {
    const hostname =
      String(
        window.location.hostname ||
        ""
      ).toLowerCase();

    const valid =
      hostname ===
        "football.cbssports.com" ||
      hostname.endsWith(
        ".football.cbssports.com"
      );

    if (!valid) {
      throw new Error(
        "This bookmark must be run from an authenticated CBS Fantasy Football league page."
      );
    }
  }


  /*
    ================================================================
    CONNECTOR LOAD
    ================================================================
  */

  async function ensureConnectorLoaded() {
    if (
      window.CBSBrowserConnector &&
      typeof window
        .CBSBrowserConnector
        .captureAll ===
        "function"
    ) {
      return;
    }

    await new Promise(
      function (
        resolve,
        reject
      ) {
        const script =
          document.createElement(
            "script"
          );

        script.src =
          CONNECTOR_URL +
          "?ts=" +
          Date.now();

        script.async =
          true;

        script.onload =
          function () {
            resolve();
          };

        script.onerror =
          function () {
            reject(
              new Error(
                "CBS blocked or failed to load the Inner Sanctum CBS connector."
              )
            );
          };

        document.head.appendChild(
          script
        );
      }
    );

    if (
      !window.CBSBrowserConnector ||
      typeof window
        .CBSBrowserConnector
        .captureAll !==
        "function"
    ) {
      throw new Error(
        "The CBS connector loaded, but CBSBrowserConnector.captureAll() is unavailable."
      );
    }
  }


  /*
    ================================================================
    CAPTURE SUMMARY
    ================================================================
  */

  function buildCaptureSummary(
    result,
    version
  ) {
    const leagueName =
      result?.league?.name ||
      "Unknown league";

    const teamName =
      result?.team?.name ||
      "Unknown team";

    const rosterCount =
      Array.isArray(
        result?.roster
      )
        ? result.roster.length
        : 0;

    const standingsCount =
      Array.isArray(
        result?.standings
      )
        ? result.standings.length
        : 0;

    const scheduleCount =
      Array.isArray(
        result?.schedule
      )
        ? result.schedule.length
        : 0;

    const scoringFormat =
      result
        ?.settings
        ?.scoringProfile
        ?.format ||
      result
        ?.meta
        ?.dataQuality
        ?.scoringFormat ||
      "Unknown";

    return {
      leagueName,
      teamName,
      rosterCount,
      standingsCount,
      scheduleCount,
      scoringFormat,
      version
    };
  }


  /*
    ================================================================
    INNER SANCTUM ORIGIN DETECTION
    ================================================================

    CBS was opened by connect-league.html.

    Modern browsers normally expose the opener's origin through
    document.referrer when navigating cross-origin.

    We accept only the two known Inner Sanctum HTTPS origins.

    If CBS strips the referrer, we fall back to the canonical
    production origin.
  */

  function getSanctumTargetOrigin() {
    try {
      if (
        document.referrer
      ) {
        const referrerUrl =
          new URL(
            document.referrer
          );

        if (
          ALLOWED_SANCTUM_ORIGINS.has(
            referrerUrl.origin
          )
        ) {
          return referrerUrl.origin;
        }
      }
    } catch (error) {
      console.warn(
        `${PREFIX} Could not parse document.referrer.`,
        error
      );
    }

    return "https://theinnersanctum.xyz";
  }


  /*
    ================================================================
    DIRECT BROWSER HANDOFF
    ================================================================
  */

  function sendCaptureToSanctum(
    result
  ) {
    if (
      !window.opener
    ) {
      throw new Error(
        "No Inner Sanctum opener window was found. Start CBS Connect from the Inner Sanctum Link Your League page, then use this bookmark."
      );
    }

    if (
      window.opener.closed
    ) {
      throw new Error(
        "The Inner Sanctum connection tab was closed. Reopen Link Your League and start CBS Connect again."
      );
    }

    const targetOrigin =
      getSanctumTargetOrigin();

    if (
      !ALLOWED_SANCTUM_ORIGINS.has(
        targetOrigin
      )
    ) {
      throw new Error(
        "The Inner Sanctum target origin could not be verified."
      );
    }

    window.opener.postMessage(
      {
        type:
          MESSAGE_TYPE,

        capture:
          result
      },
      targetOrigin
    );

    console.log(
      `${PREFIX} CBS capture sent to ${targetOrigin}.`
    );

    return targetOrigin;
  }


  /*
    ================================================================
    DISCOVERY HANDOFF (added — Phase 1)
    ================================================================

    Mirrors sendCaptureToSanctum() exactly, but for the account-level
    league-discovery result instead of a completed league capture.
    Reuses getSanctumTargetOrigin() unchanged. Sent only from the CBS
    account/hub page (not a league subdomain) — see isLeagueSubdomain()
    branch in the main flow below.
  */

  function sendDiscoveryToSanctum(
    leagues
  ) {
    if (
      !window.opener
    ) {
      throw new Error(
        "No Inner Sanctum opener window was found. Start CBS Connect from the Inner Sanctum Link Your League page, then use this bookmark."
      );
    }

    if (
      window.opener.closed
    ) {
      throw new Error(
        "The Inner Sanctum connection tab was closed. Reopen Link Your League and start CBS Connect again."
      );
    }

    const targetOrigin =
      getSanctumTargetOrigin();

    if (
      !ALLOWED_SANCTUM_ORIGINS.has(
        targetOrigin
      )
    ) {
      throw new Error(
        "The Inner Sanctum target origin could not be verified."
      );
    }

    window.opener.postMessage(
      {
        type:
          DISCOVERY_MESSAGE_TYPE,

        leagues:
          leagues
      },
      targetOrigin
    );

    console.log(
      `${PREFIX} Discovered ${leagues.length} league(s), sent to ${targetOrigin}.`
    );

    return targetOrigin;
  }


  /*
    ================================================================
    COPY JSON
    ================================================================
  */

  function addCopyButton(
    ui,
    result
  ) {
    const copyButton =
      createButton(
        "Copy JSON",
        "secondary"
      );

    copyButton.onclick =
      async function () {
        try {
          const json =
            JSON.stringify(
              result,
              null,
              2
            );

          await navigator
            .clipboard
            .writeText(
              json
            );

          copyButton.textContent =
            "Copied ✓";
        } catch (error) {
          console.error(
            `${PREFIX} Could not copy JSON:`,
            error
          );

          copyButton.textContent =
            "Copy failed";

          addStatusBox(
            ui,
            "Copy failed. The full capture is still available in:\nwindow.__innerSanctumCbsPocResult",
            "error"
          );
        }
      };

    ui.buttons.appendChild(
      copyButton
    );
  }


  /*
    ================================================================
    RETURN-TO-SANCTUM BUTTON
    ================================================================
  */

  function addReturnButton(
    ui
  ) {
    const returnButton =
      createButton(
        "Return to Inner Sanctum",
        "primary"
      );

    returnButton.onclick =
      function () {
        const targetOrigin =
          getSanctumTargetOrigin();

        /*
          Navigate this CBS tab directly back to Inner Sanctum.

          This is deterministic and does not depend on browser tab
          focus behavior or which tab Chrome chooses after closing CBS.
        */
        window.location.href =
          targetOrigin +
          "/connect-league";
      };

    ui.buttons.appendChild(
      returnButton
    );
  }


  /*
    ================================================================
    MAIN FLOW
    ================================================================
  */

  const ui =
    createPanel();

  try {
    // Branch by hostname: Phase 2 (league capture, proven, unchanged
    // below) runs on a *.football.cbssports.com league subdomain.
    // Phase 1 (new — account-level discovery) runs everywhere else,
    // e.g. https://www.cbssports.com/fantasy/games/. The existing
    // Phase 2 block below is left at its original indentation
    // on purpose, to keep this diff to the minimum necessary rather
    // than reflowing ~180 already-proven lines for cosmetic nesting.
    if (isLeagueSubdomain()) {
    /*
      Confirm this is CBS Fantasy.
    */

    assertCbsPage();

    console.log(
      `${PREFIX} Bookmarklet successfully reached CBS.`
    );

    setPanelState(
      ui,
      "Inner Sanctum CBS Connect",
      "Loading CBS connector…"
    );


    /*
      Load the proven production CBS connector.
    */

    await ensureConnectorLoaded();


    const version =
      window
        .CBSBrowserConnector
        .version ||
      "unknown";

    console.log(
      `${PREFIX} Connector v${version} loaded.`
    );


    setPanelState(
      ui,
      "Inner Sanctum CBS Connect",
      [
        `Connector v${version} loaded.`,
        "",
        "Reading your CBS fantasy league…"
      ].join("\n")
    );


    /*
      Perform the exact READ-ONLY capture already proven against
      real CBS league data.
    */

    const result =
      await window
        .CBSBrowserConnector
        .captureAll();


    /*
      Keep the result locally available for debugging.

      This does not transmit anything.
    */

    window.__innerSanctumCbsPocResult =
      result;


    console.log(
      `${PREFIX} captureAll() result:`,
      result
    );


    /*
      Build compact customer-facing summary.
    */

    const summary =
      buildCaptureSummary(
        result,
        version
      );


    /*
      Send the sanitized capture directly back to the Inner Sanctum
      window that opened CBS.
    */

    const targetOrigin =
      sendCaptureToSanctum(
        result
      );


    /*
      Update the CBS page UI.
    */

    setPanelState(
      ui,
      "✅ CBS League Sent to Inner Sanctum",
      [
        `Connector: v${summary.version}`,
        `League: ${summary.leagueName}`,
        `Team: ${summary.teamName}`,
        `Roster players: ${summary.rosterCount}`,
        `Standings teams: ${summary.standingsCount}`,
        `Schedule entries: ${summary.scheduleCount}`,
        `Scoring: ${summary.scoringFormat}`,
        "",
        "Your sanitized league information was sent",
        "directly back to the Inner Sanctum tab.",
        "",
        "No CBS password or browser cookie was shared."
      ].join("\n"),
      "success"
    );


    addStatusBox(
      ui,
      [
        "✓ Browser handoff complete",
        "",
        `Destination: ${targetOrigin}`,
        "",
        "Return to Inner Sanctum to confirm the league is connected."
      ].join("\n"),
      "success"
    );


    /*
      Optional customer controls.
    */

    addReturnButton(
      ui
    );

    addCopyButton(
      ui,
      result
    );

    } else {
      /*
        ==============================================================
        PHASE 1 — ACCOUNT-LEVEL LEAGUE DISCOVERY (added)
        ==============================================================
        Runs on the CBS account/hub page (not a league subdomain).
        Uses the existing, unmodified
        CBSBrowserConnector.discoverLeagues() (v0.3.1) — no new CBS
        endpoints, no speculative scraping. Sends the discovered
        leagues back to the Inner Sanctum opener; the opener decides
        whether to auto-continue (exactly one league) or ask the
        customer to choose (more than one) — see
        handleCbsDiscoveryResult() in connect-league.html. This CBS
        tab does not navigate itself; if the opener continues it, the
        opener does that via cbsConnectWindow.location, which is
        permitted cross-origin for a window it opened.
      */

      setPanelState(
        ui,
        "Inner Sanctum CBS Connect",
        "Loading CBS connector…"
      );

      await ensureConnectorLoaded();

      const version =
        window
          .CBSBrowserConnector
          .version ||
        "unknown";

      console.log(
        `${PREFIX} Connector v${version} loaded.`
      );

      setPanelState(
        ui,
        "Inner Sanctum CBS Connect",
        [
          `Connector v${version} loaded.`,
          "",
          "Looking for your CBS Fantasy Football league…"
        ].join("\n")
      );

      const leagues =
        window
          .CBSBrowserConnector
          .discoverLeagues();

      console.log(
        `${PREFIX} discoverLeagues() found ${leagues.length} league(s).`,
        leagues
      );

      const targetOrigin =
        sendDiscoveryToSanctum(
          leagues
        );

      if (leagues.length === 0) {
        setPanelState(
          ui,
          "No CBS league found",
          [
            "We couldn't find a CBS Fantasy Football league on this account.",
            "",
            "Make sure you're signed into the CBS account that owns or participates in your fantasy league, then try again from the Inner Sanctum tab."
          ].join("\n"),
          "error"
        );
      } else if (leagues.length === 1) {
        setPanelState(
          ui,
          "✅ League found",
          [
            (leagues[0].leagueName || leagues[0].rawText || leagues[0].leagueId),
            "",
            "Continuing to your league automatically…"
          ].join("\n"),
          "success"
        );
      } else {
        setPanelState(
          ui,
          "✅ Leagues found",
          [
            `Found ${leagues.length} CBS leagues.`,
            "",
            "Choose one on the Inner Sanctum tab to continue."
          ].join("\n"),
          "success"
        );
      }

      addStatusBox(
        ui,
        [
          "✓ League discovery sent to Inner Sanctum",
          "",
          `Destination: ${targetOrigin}`,
          "",
          "No CBS password or browser cookie was shared."
        ].join("\n"),
        "success"
      );

      addReturnButton(
        ui
      );
    }

  } catch (error) {
    console.error(
      `${PREFIX} FAILED`,
      error
    );

    setPanelState(
      ui,
      "Inner Sanctum CBS Connect — FAILED",
      String(
        error?.message ||
        error
      ),
      "error"
    );


    addStatusBox(
      ui,
      [
        "CBS league capture could not be returned to Inner Sanctum.",
        "",
        "If the league itself was captured successfully, keep this CBS tab open and restart CBS Connect from:",
        "",
        "The Inner Sanctum → Link Your League → CBS"
      ].join("\n"),
      "error"
    );
  }
})();
