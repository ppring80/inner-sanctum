/*
  THE INNER SANCTUM — cbs-poc.js
  -------------------------------------------
  CBS bookmarklet proof of concept.

  PURPOSE
  -------------------------------------------
  Prove that code launched by a bookmarklet on an authenticated
  CBS Fantasy Football league page can:

    1. load the existing production cbs-browser-connector.js
    2. execute CBSBrowserConnector.captureAll()
    3. display a validated capture summary
    4. POST the sanitized capture to The Inner Sanctum
    5. receive a safe validation response from cbs-ingest

  THIS POC
  -------------------------------------------
  This version:

    - does NOT collect CBS credentials
    - does NOT read/export CBS cookies
    - does NOT store CBS session tokens
    - does NOT modify CBS data
    - does NOT perform CBS transactions
    - does NOT persist CBS league data yet
    - does NOT associate the capture with a customer account yet
    - is READ ONLY

  NETWORK BEHAVIOR
  -------------------------------------------
  The only outbound requests are:

    GET
      https://theinnersanctum.xyz/cbs-browser-connector.js

    POST
      https://theinnersanctum.xyz/.netlify/functions/cbs-ingest

  The POST contains only the sanitized object returned by:

      CBSBrowserConnector.captureAll()

  The current cbs-ingest POC validates the payload and returns a
  safe summary. It does not persist league data.
*/

(async function () {
  "use strict";

  const PREFIX =
    "[Inner Sanctum CBS POC]";

  const PANEL_ID =
    "inner-sanctum-cbs-poc";

  const CONNECTOR_URL =
    "https://theinnersanctum.xyz/cbs-browser-connector.js";

  const INGEST_URL =
    "https://theinnersanctum.xyz/.netlify/functions/cbs-ingest";


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
      "width:430px",
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
        "This test must be run from an authenticated CBS Fantasy Football league page."
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
                "CBS blocked or failed to load cbs-browser-connector.js from The Inner Sanctum."
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
        "cbs-browser-connector.js loaded, but CBSBrowserConnector.captureAll() is not available."
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
        "primary"
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
    INGEST POST
    ================================================================
  */

  function addSendButton(
    ui,
    result
  ) {
    const sendButton =
      createButton(
        "Send Test to Inner Sanctum",
        "secondary"
      );

    sendButton.onclick =
      async function () {
        try {
          sendButton.disabled =
            true;

          sendButton.style.opacity =
            "0.6";

          sendButton.textContent =
            "Sending…";

          const response =
            await fetch(
              INGEST_URL,
              {
                method:
                  "POST",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body:
                  JSON.stringify({
                    capture:
                      result
                  })
              }
            );

          let data =
            null;

          try {
            data =
              await response.json();
          } catch (parseError) {
            throw new Error(
              "Inner Sanctum returned a non-JSON response."
            );
          }

          if (
            !response.ok ||
            !data?.success
          ) {
            throw new Error(
              data?.error ||
              "CBS ingest test failed."
            );
          }

          console.log(
            `${PREFIX} ingest response:`,
            data
          );

          sendButton.textContent =
            "Sent ✓";

          sendButton.style.opacity =
            "1";

          addStatusBox(
            ui,
            [
              "✅ Inner Sanctum received the CBS capture.",
              "",
              `League: ${data.summary?.league?.name || "Unknown"}`,
              `Team: ${data.summary?.team?.name || "Unknown"}`,
              `Roster: ${data.summary?.counts?.roster ?? 0}`,
              `Standings: ${data.summary?.counts?.standings ?? 0}`,
              `Schedule: ${data.summary?.counts?.schedule ?? 0}`,
              `Scoring: ${data.summary?.scoringFormat || "Unknown"}`,
              "",
              "POC ONLY — nothing was persisted."
            ].join("\n"),
            "success"
          );
        } catch (error) {
          console.error(
            `${PREFIX} ingest failed:`,
            error
          );

          sendButton.disabled =
            false;

          sendButton.style.opacity =
            "1";

          sendButton.textContent =
            "Send failed — retry";

          addStatusBox(
            ui,
            [
              "❌ Inner Sanctum ingest failed.",
              "",
              String(
                error?.message ||
                error
              )
            ].join("\n"),
            "error"
          );
        }
      };

    ui.buttons.appendChild(
      sendButton
    );
  }


  /*
    ================================================================
    MAIN POC FLOW
    ================================================================
  */

  const ui =
    createPanel();

  try {
    assertCbsPage();

    console.log(
      `${PREFIX} Bookmarklet bootstrap successfully reached CBS.`
    );

    setPanelState(
      ui,
      "Inner Sanctum CBS POC",
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
      "Inner Sanctum CBS POC",
      [
        `Connector v${version} loaded.`,
        "",
        "Capturing league data…"
      ].join("\n")
    );

    /*
      Execute the exact production connector already proven manually.
    */

    const result =
      await window
        .CBSBrowserConnector
        .captureAll();

    /*
      Keep the complete sanitized capture available in-page for
      debugging.

      No network transmission has happened at this point.
    */

    window.__innerSanctumCbsPocResult =
      result;

    console.log(
      `${PREFIX} captureAll() result:`,
      result
    );

    const summary =
      buildCaptureSummary(
        result,
        version
      );

    setPanelState(
      ui,
      "✅ Inner Sanctum CBS Capture Worked",
      [
        `Connector: v${summary.version}`,
        `League: ${summary.leagueName}`,
        `Team: ${summary.teamName}`,
        `Roster players: ${summary.rosterCount}`,
        `Standings teams: ${summary.standingsCount}`,
        `Schedule entries: ${summary.scheduleCount}`,
        `Scoring: ${summary.scoringFormat}`,
        "",
        "Full capture is available in:",
        "window.__innerSanctumCbsPocResult",
        "",
        "Capture complete.",
        "Nothing is persisted unless you click",
        "\"Send Test to Inner Sanctum\" below."
      ].join("\n"),
      "success"
    );

    /*
      Add POC action controls.

      COPY JSON
        Local clipboard only.

      SEND TEST
        POSTs sanitized capture to cbs-ingest.
        Current ingest endpoint validates and returns a summary only.
        It does not persist league data.
    */

    addCopyButton(
      ui,
      result
    );

    addSendButton(
      ui,
      result
    );
  } catch (error) {
    console.error(
      `${PREFIX} FAILED`,
      error
    );

    setPanelState(
      ui,
      "Inner Sanctum CBS POC — FAILED",
      String(
        error?.message ||
        error
      ),
      "error"
    );
  }
})();
