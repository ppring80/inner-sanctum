/*
  THE INNER SANCTUM — SANCTUM CONTENT BRIDGE

  Runs on:

      theinnersanctum.xyz/connect-league
      www.theinnersanctum.xyz/connect-league

  PURPOSE
  ------------------------------------------------
  The normal Inner Sanctum webpage cannot call chrome.runtime
  directly.

  This extension content script listens for the CBS connect button,
  sends a request to the extension service worker, and lets the
  service worker deliver the sanitized CBS capture back into:

      window.receiveCbsConnection(...)

  SECURITY
  ------------------------------------------------
  This script never receives or handles:

    - CBS passwords
    - CBS cookies
    - CBS session tokens
    - authorization headers

  It only starts the read-only CBS connection workflow.
*/

(function () {
  "use strict";

  function isCbsSelected() {
    return Boolean(
      document.querySelector(
        "#platform-cbs.selected"
      )
    );
  }

  function getCbsConnectButton() {
    const resultBox =
      document.getElementById(
        "cbsResult"
      );

    if (!resultBox) {
      return null;
    }

    const form =
      resultBox.closest(
        ".provider-form"
      );

    if (!form) {
      return null;
    }

    return form.querySelector(
      ".connect-btn"
    );
  }

  function getCbsResultBox() {
    return document.getElementById(
      "cbsResult"
    );
  }

  function showStatus(
    type,
    message
  ) {
    const box =
      getCbsResultBox();

    if (!box) {
      return;
    }

    box.className =
      "result-box " +
      type +
      " show";

    box.textContent =
      message;
  }

  async function beginCbsConnect() {
    const button =
      getCbsConnectButton();

    if (button) {
      button.disabled =
        true;
    }

    showStatus(
      "loading",
      "🔵 Connecting to your open CBS Fantasy league..."
    );

    try {
      const response =
        await chrome.runtime.sendMessage({
          type:
            "INNER_SANCTUM_START_CBS_CONNECT"
        });

      if (
        !response ||
        response.success !== true
      ) {
        throw new Error(
          response?.error ||
          "CBS connection failed."
        );
      }

      /*
        The service worker calls:

          window.receiveCbsConnection(captured)

        directly inside the Inner Sanctum page's MAIN world.

        That function updates LeagueConnection and refreshes the
        connected CBS UI.

        No additional storage work belongs here.
      */
    } catch (err) {
      showStatus(
        "error",
        "⚠️ " +
          (
            err?.message ||
            "CBS connection failed."
          )
      );
    } finally {
      if (button) {
        button.disabled =
          false;
      }
    }
  }

  /*
    Intercept the CBS connect button before the page's normal
    startCbsConnect() handler runs.

    We only intercept when CBS is the currently selected provider.
  */

  document.addEventListener(
    "click",
    function (event) {
      if (!isCbsSelected()) {
        return;
      }

      const button =
        event.target.closest(
          "#providerForms .connect-btn"
        );

      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      beginCbsConnect();
    },
    true
  );
})();
