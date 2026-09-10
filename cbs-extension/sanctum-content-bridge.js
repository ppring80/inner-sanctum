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

  It also keeps the CBS customer-facing instructions aligned with
  the current seamless extension flow. The page may still contain
  legacy bookmark copy while the extension is being rolled out;
  this bridge replaces that copy whenever the CBS form is rendered.

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

  function getCbsForm() {
    const resultBox =
      document.getElementById(
        "cbsResult"
      );

    return resultBox
      ? resultBox.closest(
          ".provider-form"
        )
      : null;
  }

  function getCbsResultBox() {
    return document.getElementById(
      "cbsResult"
    );
  }

  function refreshCbsCopy() {
    if (!isCbsSelected()) {
      return;
    }

    const form =
      getCbsForm();

    if (!form) {
      return;
    }

    const infoBlocks =
      form.querySelectorAll(
        ".pf-info"
      );

    if (infoBlocks.length) {
      infoBlocks[0].innerHTML =
        "<strong>Connect CBS securely.</strong><br>" +
        "Inner Sanctum opens CBS in a separate tab. Sign into CBS normally and open the league you want to connect. Inner Sanctum will detect it automatically.";
    }

    const steps =
      form.querySelectorAll(
        ".pf-step"
      );

    if (steps.length >= 3) {
      const stepThreeText =
        steps[2].querySelector(
          "span:last-child"
        );

      if (stepThreeText) {
        stepThreeText.textContent =
          "Inner Sanctum detects the league automatically and sends the sanitized read-only connection back to this tab.";
      }
    }
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
    refreshCbsCopy();

    const button =
      getCbsConnectButton();

    if (button) {
      button.disabled =
        true;
    }

    showStatus(
      "loading",
      "🔵 CBS opened. Sign in if needed and open the league you want — Inner Sanctum will connect automatically."
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
    The CBS provider form is rebuilt whenever the selected provider
    changes or a connection refreshes. Keep the seamless-flow copy
    correct after each rebuild without modifying page state.
  */

  const observer =
    new MutationObserver(
      function () {
        refreshCbsCopy();
      }
    );

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true
    }
  );

  refreshCbsCopy();

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
