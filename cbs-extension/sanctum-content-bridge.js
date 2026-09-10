/*
  THE INNER SANCTUM — SANCTUM CONTENT BRIDGE

  Runs on the Link Your League page. CBS behavior remains unchanged.
  ESPN uses the browser extension so customers authenticate normally on ESPN
  and never copy/paste passwords, cookies, SWID, espn_s2 or DevTools values.
*/

(function () {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;

  function isSelected(provider) {
    return Boolean(document.querySelector("#platform-" + provider + ".selected"));
  }

  function getResultBox(provider) {
    return document.getElementById(provider + "Result");
  }

  function getConnectButton(provider) {
    const result = getResultBox(provider);
    const form = result ? result.closest(".provider-form") : null;
    return form ? form.querySelector(".connect-btn") : null;
  }

  function showStatus(provider, type, message) {
    const box = getResultBox(provider);
    if (!box) return;
    box.className = "result-box " + type + " show";
    box.textContent = message;
  }

  async function beginCbsConnect() {
    const button = getConnectButton("cbs");
    if (button) button.disabled = true;

    showStatus("cbs", "loading", "🔵 Connecting to your open CBS Fantasy league...");

    try {
      const response = await extensionApi.runtime.sendMessage({
        type: "INNER_SANCTUM_START_CBS_CONNECT"
      });

      if (!response || response.success !== true) {
        throw new Error(response?.error || "CBS connection failed.");
      }
    } catch (err) {
      showStatus("cbs", "error", "⚠️ " + (err?.message || "CBS connection failed."));
    } finally {
      if (button) button.disabled = false;
    }
  }

  function refreshEspnForm() {
    if (!isSelected("espn")) return;

    const result = getResultBox("espn");
    const form = result ? result.closest(".provider-form") : null;
    if (!form) return;

    form.querySelectorAll(".pf-group, #espnPrivateFields").forEach(function (element) {
      element.style.display = "none";
    });

    let info = form.querySelector(".inner-sanctum-espn-connect-info");
    if (!info) {
      info = document.createElement("div");
      info.className = "pf-info inner-sanctum-espn-connect-info";
      const button = getConnectButton("espn");
      if (button) form.insertBefore(info, button);
    }

    if (info) {
      info.innerHTML =
        "<strong>Connect ESPN securely.</strong><br>" +
        "Inner Sanctum opens ESPN in a separate tab. Sign into ESPN normally and open the league you want to connect. " +
        "Inner Sanctum detects it automatically — no League ID, Public/Private selection, Developer Tools, SWID or espn_s2 copy/paste required.";
    }

    const button = getConnectButton("espn");
    if (button) button.textContent = "Connect ESPN League";

    const note = form.querySelector(".connect-note");
    if (note) {
      note.textContent =
        "ESPN Connect is read-only. Your ESPN sign-in stays in ESPN; only sanitized fantasy-league data is returned to Inner Sanctum.";
    }
  }

  async function beginEspnConnect() {
    refreshEspnForm();

    const button = getConnectButton("espn");
    if (button) button.disabled = true;

    showStatus(
      "espn",
      "loading",
      "🔴 ESPN opened. Sign in if needed and open the league you want — Inner Sanctum will connect automatically."
    );

    try {
      const response = await extensionApi.runtime.sendMessage({
        type: "INNER_SANCTUM_START_ESPN_CONNECT"
      });

      if (!response || response.success !== true) {
        throw new Error(response?.error || "ESPN connection failed.");
      }
    } catch (err) {
      const raw = err?.message || "ESPN connection failed.";
      const message = /Extension context invalidated/i.test(raw)
        ? "Inner Sanctum Connect was updated. Refresh this page and try again."
        : raw;

      showStatus("espn", "error", "⚠️ " + message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  let refreshQueued = false;
  function queueEspnRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(function () {
      refreshQueued = false;
      refreshEspnForm();
    });
  }

  const observer = new MutationObserver(queueEspnRefresh);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  refreshEspnForm();

  document.addEventListener(
    "click",
    function (event) {
      const button = event.target.closest("#providerForms .connect-btn");
      if (!button) return;

      if (isSelected("espn")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        beginEspnConnect();
        return;
      }

      if (isSelected("cbs")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        beginCbsConnect();
      }
    },
    true
  );
})();
