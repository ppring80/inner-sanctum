/*
  THE INNER SANCTUM — cbs-poc.js
  -------------------------------------------
  CBS bookmarklet proof of concept.

  PURPOSE:
  Prove that code launched by a bookmarklet on an authenticated
  CBS Fantasy Football league page can load the existing
  cbs-browser-connector.js and execute captureAll().

  THIS POC:
    - does NOT send CBS data anywhere
    - does NOT collect credentials
    - does NOT read/export cookies
    - does NOT modify CBS data
    - does NOT connect a customer account yet
    - is READ ONLY
*/

(async function () {
  const PREFIX = "[Inner Sanctum CBS POC]";

  function showMessage(title, message, isError = false) {
    const existing = document.getElementById(
      "inner-sanctum-cbs-poc"
    );

    if (existing) {
      existing.remove();
    }

    const panel = document.createElement("div");

    panel.id = "inner-sanctum-cbs-poc";

    panel.style.cssText = [
      "position:fixed",
      "top:20px",
      "right:20px",
      "z-index:2147483647",
      "width:420px",
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
      "line-height:1.45",
    ].join(";");

    const heading = document.createElement("div");

    heading.textContent = title;

    heading.style.cssText = [
      "font-size:18px",
      "font-weight:700",
      "margin-bottom:10px",
      isError ? "color:#ff6b6b" : "color:#d4af37",
    ].join(";");

    const body = document.createElement("div");

    body.textContent = message;
    body.style.whiteSpace = "pre-wrap";

    panel.appendChild(heading);
    panel.appendChild(body);

    document.body.appendChild(panel);

    return {
      panel,
      heading,
      body,
    };
  }

  try {
    /*
      STEP 1
      Confirm we are actually running on a CBS Fantasy Football page.
    */

    const hostname = String(
      window.location.hostname || ""
    ).toLowerCase();

    if (
      hostname !== "football.cbssports.com" &&
      !hostname.endsWith(".football.cbssports.com")
    ) {
      showMessage(
        "Inner Sanctum CBS POC",
        "This test must be run from an authenticated CBS Fantasy Football league page.",
        true
      );

      return;
    }

    console.log(
      `${PREFIX} Bookmarklet bootstrap successfully reached CBS.`
    );

    const ui = showMessage(
      "Inner Sanctum CBS POC",
      "Loading CBS connector…"
    );

    /*
      STEP 2
      If the connector is already present, use it.

      Otherwise load the existing production connector directly from
      The Inner Sanctum.
    */

    if (
      !window.CBSBrowserConnector ||
      typeof window.CBSBrowserConnector.captureAll !== "function"
    ) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");

        script.src =
          "https://theinnersanctum.xyz/cbs-browser-connector.js?ts=" +
          Date.now();

        script.async = true;

        script.onload = () => resolve();

        script.onerror = () => {
          reject(
            new Error(
              "CBS blocked or failed to load cbs-browser-connector.js from The Inner Sanctum."
            )
          );
        };

        document.head.appendChild(script);
      });
    }

    /*
      STEP 3
      Verify the connector actually became available.
    */

    if (
      !window.CBSBrowserConnector ||
      typeof window.CBSBrowserConnector.captureAll !== "function"
    ) {
      throw new Error(
        "cbs-browser-connector.js loaded, but CBSBrowserConnector.captureAll() is not available."
      );
    }

    const version =
      window.CBSBrowserConnector.version || "unknown";

    ui.body.textContent =
      `Connector v${version} loaded.\n\nCapturing league data…`;

    console.log(
      `${PREFIX} Connector v${version} loaded.`
    );

    /*
      STEP 4
      Execute the exact connector we already proved manually.
    */

    const result =
      await window.CBSBrowserConnector.captureAll();

    /*
      Keep the result available in the CBS page for debugging.

      Nothing is transmitted anywhere.
    */

    window.__innerSanctumCbsPocResult = result;

    console.log(
      `${PREFIX} captureAll() result:`,
      result
    );

    /*
      STEP 5
      Render a compact success summary rather than dumping thousands
      of lines of JSON into the CBS page.
    */

    const leagueName =
      result?.league?.name || "Unknown league";

    const teamName =
      result?.team?.name || "Unknown team";

    const rosterCount =
      Array.isArray(result?.roster)
        ? result.roster.length
        : 0;

    const standingsCount =
      Array.isArray(result?.standings)
        ? result.standings.length
        : 0;

    const scheduleCount =
      Array.isArray(result?.schedule)
        ? result.schedule.length
        : 0;

    const scoringFormat =
      result?.settings?.scoringProfile?.format ||
      "Unknown";

    ui.heading.textContent =
      "✅ Inner Sanctum CBS Capture Worked";

    ui.body.textContent = [
      `Connector: v${version}`,
      `League: ${leagueName}`,
      `Team: ${teamName}`,
      `Roster players: ${rosterCount}`,
      `Standings teams: ${standingsCount}`,
      `Schedule entries: ${scheduleCount}`,
      `Scoring: ${scoringFormat}`,
      "",
      "Full capture is available in:",
      "window.__innerSanctumCbsPocResult",
      "",
      "NO DATA WAS SENT TO INNER SANCTUM.",
    ].join("\n");

    /*
      Add a Copy JSON button so we can inspect the exact result if
      necessary without requiring another capture.
    */

    const copyButton =
      document.createElement("button");

    copyButton.textContent = "Copy JSON";

    copyButton.style.cssText = [
      "margin-top:14px",
      "padding:9px 14px",
      "border:0",
      "border-radius:7px",
      "background:#d4af37",
      "color:#111",
      "font-weight:700",
      "cursor:pointer",
    ].join(";");

    copyButton.onclick = async () => {
      try {
        const json =
          JSON.stringify(result, null, 2);

        await navigator.clipboard.writeText(json);

        copyButton.textContent = "Copied ✓";
      } catch (error) {
        console.error(
          `${PREFIX} Could not copy JSON:`,
          error
        );

        copyButton.textContent =
          "Copy failed — see Console";
      }
    };

    ui.panel.appendChild(copyButton);
  } catch (error) {
    console.error(
      `${PREFIX} FAILED`,
      error
    );

    showMessage(
      "Inner Sanctum CBS POC — FAILED",
      String(error?.message || error),
      true
    );
  }
})();
