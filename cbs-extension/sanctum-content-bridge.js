/*
  THE INNER SANCTUM — SANCTUM CONTENT BRIDGE

  Runs on The Inner Sanctum Link Your League page. It intercepts CBS and
  ESPN connect actions and hands them to the browser extension so customers
  can authenticate normally on the provider site without copying passwords,
  cookies, SWID, espn_s2, or developer-tool values.
*/

(function () {
  "use strict";

  function selectedProvider() {
    const selected =
      document.querySelector(
        ".platform-btn.selected"
      );

    if (!selected?.id) {
      return null;
    }

    return selected.id.replace(
      /^platform-/,
      ""
    );
  }

  function getProviderForm(
    provider
  ) {
    const result =
      document.getElementById(
        provider + "Result"
      );

    return result
      ? result.closest(
          ".provider-form"
        )
      : null;
  }

  function getProviderButton(
    provider
  ) {
    const form =
      getProviderForm(provider);

    return form
      ? form.querySelector(
          ".connect-btn"
        )
      : null;
  }

  function showStatus(
    provider,
    type,
    message
  ) {
    const box =
      document.getElementById(
        provider + "Result"
      );

    if (!box) {
      return;
    }

    box.className =
      "result-box " +
      type +
      " show";

    box.textContent = message;
  }

  function refreshCbsCopy() {
    if (
      selectedProvider() !== "cbs"
    ) {
      return;
    }

    const form =
      getProviderForm("cbs");

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
      const text =
        steps[2].querySelector(
          "span:last-child"
        );

      if (text) {
        text.textContent =
          "Inner Sanctum detects the league automatically and sends the sanitized read-only connection back to this tab.";
      }
    }
  }

  function refreshEspnCopy() {
    if (
      selectedProvider() !== "espn"
    ) {
      return;
    }

    const form =
      getProviderForm("espn");

    if (!form) {
      return;
    }

    form
      .querySelectorAll(
        ".pf-group, #espnPrivateFields"
      )
      .forEach(function (el) {
        el.style.display = "none";
      });

    let info =
      form.querySelector(
        ".inner-sanctum-espn-connect-info"
      );

    if (!info) {
      info =
        document.createElement(
          "div"
        );

      info.className =
        "pf-info inner-sanctum-espn-connect-info";

      const button =
        getProviderButton("espn");

      if (button) {
        form.insertBefore(
          info,
          button
        );
      }
    }

    if (info) {
      info.innerHTML =
        "<strong>Connect ESPN securely.</strong><br>" +
        "Inner Sanctum opens ESPN in a separate tab. Sign into ESPN normally and open the league you want to connect. Inner Sanctum will detect it automatically — no Developer Tools, SWID, or espn_s2 copy/paste required.";
    }

    const button =
      getProviderButton("espn");

    if (button) {
      button.textContent =
        "Connect ESPN League";
    }

    const note =
      form.querySelector(
        ".connect-note"
      );

    if (note) {
      note.textContent =
        "ESPN Connect is in beta. Inner Sanctum uses your already signed-in ESPN browser session only to read the fantasy league you choose.";
    }
  }

  function refreshProviderCopy() {
    refreshCbsCopy();
    refreshEspnCopy();
  }

  async function beginConnect(
    provider
  ) {
    refreshProviderCopy();

    const button =
      getProviderButton(provider);

    if (button) {
      button.disabled = true;
    }

    showStatus(
      provider,
      "loading",
      provider === "cbs"
        ? "🔵 CBS opened. Sign in if needed and open the league you want — Inner Sanctum will connect automatically."
        : "🔴 ESPN opened. Sign in if needed and open the league you want — Inner Sanctum will connect automatically."
    );

    const messageType =
      provider === "cbs"
        ? "INNER_SANCTUM_START_CBS_CONNECT"
        : "INNER_SANCTUM_START_ESPN_CONNECT";

    try {
      const response =
        await chrome.runtime.sendMessage({
          type: messageType
        });

      if (
        !response ||
        response.success !== true
      ) {
        throw new Error(
          response?.error ||
          provider.toUpperCase() +
            " connection failed."
        );
      }
    } catch (err) {
      const raw =
        err?.message ||
        provider.toUpperCase() +
          " connection failed.";

      const message =
        /Extension context invalidated/i
          .test(raw)
          ? "Inner Sanctum Connect was updated. Refresh this page and try again."
          : raw;

      showStatus(
        provider,
        "error",
        "⚠️ " + message
      );
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  const observer =
    new MutationObserver(
      refreshProviderCopy
    );

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true
    }
  );

  refreshProviderCopy();

  document.addEventListener(
    "click",
    function (event) {
      const provider =
        selectedProvider();

      if (
        provider !== "cbs" &&
        provider !== "espn"
      ) {
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

      beginConnect(provider);
    },
    true
  );
})();
