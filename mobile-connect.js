/*
  THE INNER SANCTUM — mobile-connect.js  (Phase 1, mobile league-connect)
  ------------------------------------------------------------------------
  Provider-neutral "bring your league to this device" flow.

  <script src="/mobile-connect.js"></script>
  (include after league-connection.js and provider-adapters.js)

  DESKTOP (Windows, Mac, Linux — including touch-screen laptops)
    - Never rewrites the CBS or ESPN provider forms.
    - Adds a separate "Send to my phone" panel after #providerForms when the
      active league is a supported provider. It creates a one-time link via
      /.netlify/functions/connection-handoff and shows it as a QR code plus a
      copyable link.

  MOBILE (Android, iPhone, iPad including iPadOS desktop-style user agents)
    - For CBS and ESPN, replaces the desktop-only connection instructions with
      one provider-neutral message: already connected on a computer? Bring your
      league to this device.

  ANY DEVICE
    - /connect-league#handoff=<code> (production form): the code is read and
      removed from the address bar as soon as this script evaluates, before any
      request, then claimed once, validated, and saved with the same
      LeagueConnection API the existing connection flows use; then the ChatGPT
      snapshot refresh runs and the connected state renders. A fragment is
      never sent in HTTP requests, server logs or Referer headers.
    - /connect-league?handoff=<code> is still accepted for compatibility with
      links created before the fragment form; it is removed the same way.
    - The code is never written to localStorage or sessionStorage.

  What moves between devices is the finished, sanitized LeagueConnection
  record. No provider password, cookie or session value is ever involved, and
  the ChatGPT link is never included.

  Adding a provider later (for example Yahoo) only requires adding it to
  HANDOFF_PROVIDERS here and in the handoff function.
*/

(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var HANDOFF_ENDPOINT = "/.netlify/functions/connection-handoff";
  var HANDOFF_PROVIDERS = ["cbs", "espn"];
  var QR_SCRIPT_SRC = "/vendor/qrcode-generator-2.0.4.js";
  var DESKTOP_PANEL_ID = "isDeviceHandoffPanel";
  var MOBILE_FORM_CLASS = "is-mobile-connect";
  var MOBILE_RESULT_ID = "isMobileConnectResult";
  var STYLE_ID = "isMobileConnectStyles";
  var HANDOFF_PARAM = "handoff";

  var PROVIDER_NAMES = { cbs: "CBS", espn: "ESPN", yahoo: "Yahoo", sleeper: "Sleeper" };

  /* ------------------------------------------------------------------ */
  /* Device detection                                                    */
  /* ------------------------------------------------------------------ */

  function detectDevice(nav) {
    var ua = String((nav && nav.userAgent) || "");
    var touchPoints = Number((nav && nav.maxTouchPoints) || 0);

    // Order matters: Windows/Linux desktops (touch screens included) are never
    // mobile, even though they may report touch points.
    if (/Android/i.test(ua)) return { mobile: true, kind: "android" };
    if (/iPhone|iPod/i.test(ua)) return { mobile: true, kind: "iphone" };
    if (/iPad/i.test(ua)) return { mobile: true, kind: "ipad" };
    // iPadOS 13+ Safari reports a Macintosh user agent. Macs have no touch
    // screen (maxTouchPoints is 0), so a "Macintosh" with multi-touch is an iPad.
    if (/Macintosh/i.test(ua) && touchPoints > 1) return { mobile: true, kind: "ipad" };
    return { mobile: false, kind: "desktop" };
  }

  var device = detectDevice(window.navigator);

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  function providerName(provider) {
    return PROVIDER_NAMES[provider] || "your";
  }

  function isHandoffProvider(provider) {
    return HANDOFF_PROVIDERS.indexOf(provider) >= 0;
  }

  function hasValue(value) {
    return value !== null && value !== undefined && String(value).trim() !== "";
  }

  function isTransferableRecord(record) {
    return Boolean(
      record &&
      typeof record === "object" &&
      isHandoffProvider(record.provider) &&
      hasValue(record.leagueId) &&
      hasValue(record.teamId) &&
      Array.isArray(record.roster)
    );
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function leagueConnection() {
    return window.LeagueConnection || null;
  }

  function currentSelectedProvider() {
    try {
      return window.selectedProvider || null;
    } catch (e) {
      return null;
    }
  }

  function formatTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    try {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return date.toISOString().slice(11, 16);
    }
  }

  function formatSynced(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    try {
      return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return date.toISOString().slice(0, 16).replace("T", " ");
    }
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = el("style");
    style.id = STYLE_ID;
    style.textContent =
      ".is-handoff-panel{margin-top:16px;padding:16px;border:1px solid rgba(201,162,75,.35);border-radius:10px;background:rgba(20,15,9,.6)}" +
      ".is-handoff-title{font-family:'Cinzel',serif;font-size:14px;color:#f2e6c8;margin-bottom:6px}" +
      ".is-handoff-copy{font-size:13px;color:#b9a882;margin:0 0 12px}" +
      ".is-handoff-btn{background:#C9A24B;color:#140f09;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer}" +
      ".is-handoff-btn[disabled]{opacity:.6;cursor:wait}" +
      ".is-handoff-output{margin-top:14px}" +
      ".is-handoff-qr{background:#fff;padding:10px;border-radius:8px;display:inline-block;line-height:0}" +
      ".is-handoff-qr svg{width:200px;height:200px}" +
      ".is-handoff-link-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}" +
      ".is-handoff-link{flex:1 1 260px;min-width:0;background:#1d160d;color:#f2e6c8;border:1px solid rgba(201,162,75,.35);border-radius:6px;padding:8px;font-size:12px}" +
      ".is-handoff-copy-btn{background:transparent;color:#C9A24B;border:1px solid #C9A24B;border-radius:6px;padding:8px 12px;cursor:pointer}" +
      ".is-handoff-note{font-size:12px;color:#9c8c68;margin-top:8px}" +
      ".is-handoff-status{margin-top:10px;font-size:13px}" +
      ".is-handoff-status.error{color:#e8907a}.is-handoff-status.success{color:#9fd6a1}";
    (document.head || document.documentElement).appendChild(style);
  }

  // Fragment (#handoff=) is the production form; the query form (?handoff=)
  // is accepted only for compatibility with earlier links.
  function readHandoffCode() {
    var loc = window.location;
    try {
      var hash = String(loc.hash || "").replace(/^#/, "");
      var fromFragment = new URLSearchParams(hash).get(HANDOFF_PARAM);
      if (fromFragment) return fromFragment;
      return new URLSearchParams(loc.search || "").get(HANDOFF_PARAM) || null;
    } catch (e) {
      return null;
    }
  }

  function stripHandoffFromUrl() {
    var loc = window.location;
    try {
      var params = new URLSearchParams(loc.search || "");
      params.delete(HANDOFF_PARAM);
      var search = params.toString();
      var hashParams = new URLSearchParams(String(loc.hash || "").replace(/^#/, ""));
      var hadHashCode = hashParams.has(HANDOFF_PARAM);
      hashParams.delete(HANDOFF_PARAM);
      var hash = hadHashCode ? hashParams.toString() : String(loc.hash || "").replace(/^#/, "");
      var clean = loc.pathname + (search ? "?" + search : "") + (hash ? "#" + hash : "");
      if (window.history && typeof window.history.replaceState === "function") {
        window.history.replaceState(window.history.state || null, "", clean);
      }
      return clean;
    } catch (e) {
      return null;
    }
  }

  function postHandoff(body) {
    return window.fetch(HANDOFF_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store"
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data || {} };
      });
    });
  }

  function rerenderPage() {
    ["renderPlatformRow", "renderConnectedBanner", "renderProviderForm", "renderChatGptLinkPanel"].forEach(function (name) {
      if (typeof window[name] === "function") {
        try { window[name](); } catch (e) { /* keep the import result visible */ }
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* QR code (vendored, loaded only when needed)                         */
  /* ------------------------------------------------------------------ */

  var qrLoader = null;

  function loadQrLibrary() {
    if (typeof window.qrcode === "function") return Promise.resolve(window.qrcode);
    if (qrLoader) return qrLoader;
    qrLoader = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = QR_SCRIPT_SRC;
      script.async = true;
      script.addEventListener("load", function () {
        if (typeof window.qrcode === "function") resolve(window.qrcode);
        else reject(new Error("QR unavailable"));
      });
      script.addEventListener("error", function () { reject(new Error("QR unavailable")); });
      (document.head || document.documentElement).appendChild(script);
    });
    qrLoader.catch(function () { qrLoader = null; });
    return qrLoader;
  }

  function buildQrSvg(qrcodeFactory, text) {
    var qr = qrcodeFactory(0, "M");
    qr.addData(text, "Byte");
    qr.make();
    var count = qr.getModuleCount();
    var quiet = 4;
    var size = count + quiet * 2;
    var path = "";
    for (var row = 0; row < count; row += 1) {
      for (var col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) path += "M" + (col + quiet) + " " + (row + quiet) + "h1v1h-1z";
      }
    }
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS
      ? document.createElementNS(svgNS, "svg")
      : document.createElement("svg");
    svg.setAttribute("viewBox", "0 0 " + size + " " + size);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code for your one-time link");
    svg.setAttribute("shape-rendering", "crispEdges");
    var shape = document.createElementNS ? document.createElementNS(svgNS, "path") : document.createElement("path");
    shape.setAttribute("d", path);
    shape.setAttribute("fill", "#000");
    svg.appendChild(shape);
    return { svg: svg, moduleCount: count };
  }

  /* ------------------------------------------------------------------ */
  /* Desktop: Send to my phone                                           */
  /* ------------------------------------------------------------------ */

  function activeTransferableConnection() {
    var LC = leagueConnection();
    if (!LC) return null;
    var active = LC.getActiveConnection ? LC.getActiveConnection() : null;
    return isTransferableRecord(active) ? active : null;
  }

  function ensureDesktopPanel() {
    var panel = document.getElementById(DESKTOP_PANEL_ID);
    if (panel) return panel;
    var forms = document.getElementById("providerForms");
    if (!forms || !forms.parentNode) return null;
    ensureStyles();
    panel = el("div", "is-handoff-panel");
    panel.id = DESKTOP_PANEL_ID;
    forms.parentNode.insertBefore(panel, forms.nextSibling);
    return panel;
  }

  function renderDesktopPanel() {
    var existing = document.getElementById(DESKTOP_PANEL_ID);
    if (existing && existing.getAttribute("data-busy") === "1") return;

    var connection = activeTransferableConnection();
    var connectionKey = connection ? connection.provider + ":" + connection.connectionId : "";

    if (!connection) {
      if (existing && existing.getAttribute("data-mode") === "send") existing.remove();
      return;
    }
    if (existing && existing.getAttribute("data-mode") === "send" &&
        existing.getAttribute("data-connection") === connectionKey) {
      return;
    }

    var panel = existing || ensureDesktopPanel();
    if (!panel) return;
    panel.innerHTML = "";
    panel.setAttribute("data-mode", "send");
    panel.setAttribute("data-connection", connectionKey);

    var name = providerName(connection.provider);
    panel.appendChild(el("div", "is-handoff-title", "Use this league on your phone"));
    panel.appendChild(el(
      "p",
      "is-handoff-copy",
      "Send your connected " + name + " league to your phone or tablet. It works once and no passwords are shared."
    ));
    var button = el("button", "is-handoff-btn", "Send to my phone");
    button.type = "button";
    button.addEventListener("click", function () { sendToPhone(panel, connection.provider, button); });
    panel.appendChild(button);
    panel.appendChild(el("div", "is-handoff-output"));
  }

  function sendToPhone(panel, provider, button) {
    var LC = leagueConnection();
    var record = LC && LC.getConnection ? LC.getConnection(provider) : null;
    var output = panel.querySelector(".is-handoff-output");
    output.innerHTML = "";

    if (!isTransferableRecord(record)) {
      output.appendChild(el("div", "is-handoff-status error", "Connect your league on this computer first, then try again."));
      return Promise.resolve(false);
    }

    button.disabled = true;
    panel.setAttribute("data-busy", "1");
    output.appendChild(el("div", "is-handoff-status", "Creating your link…"));

    return postHandoff({ action: "create", record: record })
      .then(function (result) {
        if (!result.ok || !result.data || !result.data.code) {
          throw new Error((result.data && result.data.error) || "We couldn't create a link. Please try again.");
        }
        // Fragment form: the code never appears in an HTTP request, access log
        // or Referer header.
        var link = window.location.origin + "/connect-league#" + HANDOFF_PARAM + "=" + encodeURIComponent(result.data.code);
        return renderHandoffLink(output, link, result.data.expiresAt);
      })
      .catch(function (err) {
        output.innerHTML = "";
        output.appendChild(el("div", "is-handoff-status error", (err && err.message) || "We couldn't create a link. Please try again."));
        return false;
      })
      .then(function (value) {
        button.disabled = false;
        button.textContent = "Send a new link";
        panel.removeAttribute("data-busy");
        return value;
      });
  }

  function renderHandoffLink(output, link, expiresAt) {
    output.innerHTML = "";
    var qrWrap = el("div", "is-handoff-qr");
    output.appendChild(qrWrap);

    var row = el("div", "is-handoff-link-row");
    var input = el("input", "is-handoff-link");
    input.type = "text";
    input.readOnly = true;
    input.value = link;
    input.setAttribute("value", link);
    input.setAttribute("aria-label", "One-time link for your phone");
    var copy = el("button", "is-handoff-copy-btn", "Copy link");
    copy.type = "button";
    copy.addEventListener("click", function () {
      var done = function () { copy.textContent = "Copied"; };
      try {
        if (window.navigator.clipboard && window.navigator.clipboard.writeText) {
          window.navigator.clipboard.writeText(link).then(done, function () {});
        } else if (input.select) {
          input.select();
          if (document.execCommand) document.execCommand("copy");
          done();
        }
      } catch (e) { /* the link stays visible for manual copy */ }
    });
    row.appendChild(input);
    row.appendChild(copy);
    output.appendChild(row);

    var when = formatTime(expiresAt);
    output.appendChild(el(
      "div",
      "is-handoff-note",
      "Scan this code with your phone's camera, or open the link on your phone. " +
      "It works once and expires in 10 minutes" + (when ? " (at " + when + ")." : ".")
    ));

    return loadQrLibrary()
      .then(function (factory) {
        qrWrap.appendChild(buildQrSvg(factory, link).svg);
        return true;
      })
      .catch(function () {
        qrWrap.remove();
        return true;
      });
  }

  /* ------------------------------------------------------------------ */
  /* Mobile: provider-neutral connect panel                              */
  /* ------------------------------------------------------------------ */

  function renderMobileForm() {
    if (!device.mobile) return;
    var provider = currentSelectedProvider();
    if (!isHandoffProvider(provider)) return;
    var forms = document.getElementById("providerForms");
    if (!forms) return;

    var LC = leagueConnection();
    var connection = LC && LC.getConnection ? LC.getConnection(provider) : null;
    var stateKey = provider + ":" + (connection ? connection.connectionId + ":" + (connection.syncedAt || "") : "none");
    var current = forms.querySelector("." + MOBILE_FORM_CLASS);
    if (current && current.getAttribute("data-state") === stateKey) return;

    var previousResult = document.getElementById(MOBILE_RESULT_ID);
    var keepResult = previousResult && /\bshow\b/.test(previousResult.className)
      ? { className: previousResult.className, html: previousResult.innerHTML }
      : null;

    var name = providerName(provider);
    var form = el("div", "provider-form show " + MOBILE_FORM_CLASS);
    form.setAttribute("data-provider", provider);
    form.setAttribute("data-state", stateKey);

    if (connection && isTransferableRecord(connection)) {
      var info = el("div", "pf-info");
      info.appendChild(el("strong", "", "League connected"));
      info.appendChild(el("br"));
      info.appendChild(document.createTextNode(
        [connection.leagueName, connection.teamName].filter(Boolean).join(" · ")
      ));
      if (connection.syncedAt) {
        info.appendChild(el("br"));
        info.appendChild(document.createTextNode("League synced " + formatSynced(connection.syncedAt)));
      }
      form.appendChild(info);
      form.appendChild(el(
        "div",
        "connect-note",
        "To refresh this league, choose Send to my phone on your computer after it syncs."
      ));
    } else {
      var intro = el("div", "pf-info");
      intro.appendChild(el("strong", "", "Already connected on a computer? Bring your league to this device."));
      intro.appendChild(el("br"));
      intro.appendChild(document.createTextNode(
        "On your computer, open Link Your League, connect your " + name +
        " league, then choose Send to my phone. Scan the code with this device's camera or open the link."
      ));
      form.appendChild(intro);
      form.appendChild(el(
        "div",
        "connect-note",
        "Not connected yet? Connect " + name + " once on a computer, then send it here. " +
        "Inner Sanctum never asks for your " + name + " password."
      ));
    }

    var result = el("div", "result-box");
    result.id = MOBILE_RESULT_ID;
    if (keepResult) {
      result.className = keepResult.className;
      result.innerHTML = keepResult.html;
    }
    form.appendChild(result);

    forms.innerHTML = "";
    forms.appendChild(form);
  }

  function scheduleMobileRender() {
    window.setTimeout(renderMobileForm, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Handoff import (any device)                                         */
  /* ------------------------------------------------------------------ */

  function statusTarget() {
    if (device.mobile) {
      renderMobileForm();
      var mobileBox = document.getElementById(MOBILE_RESULT_ID);
      if (mobileBox) return { kind: "mobile", node: mobileBox };
    }
    var panel = document.getElementById(DESKTOP_PANEL_ID) || ensureDesktopPanel();
    if (!panel) return null;
    var status = panel.querySelector(".is-handoff-import-status");
    if (!status) {
      status = el("div", "is-handoff-status is-handoff-import-status");
      panel.insertBefore(status, panel.firstChild);
    }
    return { kind: "desktop", node: status };
  }

  function showStatus(type, html) {
    var target = statusTarget();
    if (!target) return;
    if (target.kind === "mobile") {
      target.node.className = "result-box " + type + " show";
    } else {
      target.node.className = "is-handoff-status is-handoff-import-status " + type;
    }
    target.node.innerHTML = html;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sameLeagueAndTeam(a, b) {
    return Boolean(a && b &&
      String(a.leagueId) === String(b.leagueId) &&
      String(a.teamId) === String(b.teamId));
  }

  function saveRecord(record) {
    var LC = leagueConnection();
    if (!LC) throw new Error("League connection is unavailable.");
    var provider = record.provider;
    // Same semantics as the existing connection flows (update when this device
    // already holds this league), without ever overwriting a DIFFERENT league
    // of the same provider: in that case connect() adds it alongside.
    var existing = LC.isConnected(provider) ? LC.getConnection(provider) : null;
    if (existing && sameLeagueAndTeam(existing, record)) {
      return LC.update(provider, record);
    }
    return LC.connect(provider, record);
  }

  function importHandoff(code) {
    showStatus("loading", "Bringing your league to this device…");

    return postHandoff({ action: "claim", code: code })
      .then(function (result) {
        if (!result.ok) {
          var error = new Error(
            (result.data && result.data.error) ||
            "This link has expired or was already used. On your computer, choose Send to my phone to get a new one."
          );
          error.handoffStatus = result.status;
          throw error;
        }
        var record = result.data && result.data.record;
        if (!isTransferableRecord(record)) {
          throw new Error("That league could not be added. On your computer, choose Send to my phone to try again.");
        }
        var saved = saveRecord(record);
        try { window.selectedProvider = record.provider; } catch (e) { /* page global */ }
        rerenderPage();
        var refresh = typeof window.refreshChatGptLinkIfNeeded === "function"
          ? window.refreshChatGptLinkIfNeeded(record.provider)
          : Promise.resolve(false);
        return Promise.resolve(refresh).catch(function () { return false; }).then(function () {
          return saved;
        });
      })
      .then(function (saved) {
        renderMobileForm();
        renderDesktopPanel();
        showStatus(
          "success",
          "<strong>✓ League connected.</strong><br>" +
          escapeHtml([saved.leagueName, saved.teamName].filter(Boolean).join(" · ")) +
          (saved.syncedAt ? "<br>League synced " + escapeHtml(formatSynced(saved.syncedAt)) : "")
        );
        return saved;
      })
      .catch(function (err) {
        // fetch() rejects with a TypeError when the network is unreachable.
        var networkFailure = err && err.handoffStatus === undefined && err.name === "TypeError";
        var message = networkFailure
          ? "We couldn't reach Inner Sanctum. Check your connection, then choose Send to my phone on your computer to get a new link."
          : (err && err.message) || "Something went wrong. Please try again.";
        showStatus("error", "⚠️ " + escapeHtml(message));
        return null;
      });
  }

  /* ------------------------------------------------------------------ */
  /* Startup                                                             */
  /* ------------------------------------------------------------------ */

  // Remove a handoff code from the address bar as early as possible so it is
  // not left in history, bookmarks or shared screenshots.
  var pendingCode = readHandoffCode();
  if (pendingCode) stripHandoffFromUrl();

  var importPromise = null;

  function start() {
    renderDesktopPanelIfDesktop();
    if (device.mobile) {
      renderMobileForm();
      document.addEventListener("click", function (event) {
        var target = event && event.target;
        if (target && target.closest && target.closest(".platform-btn")) scheduleMobileRender();
      });
      var forms = document.getElementById("providerForms");
      if (forms && typeof window.MutationObserver === "function") {
        new window.MutationObserver(function () { renderMobileForm(); }).observe(forms, { childList: true });
      }
    }
    window.addEventListener("innerSanctum:leagueContextChanged", function () {
      window.setTimeout(function () {
        renderDesktopPanelIfDesktop();
        renderMobileForm();
      }, 0);
    });
    // A link opened in an already-open Link Your League tab only changes the
    // fragment (no reload), so handle it here too.
    window.addEventListener("hashchange", function () {
      var code = readHandoffCode();
      if (!code) return;
      stripHandoffFromUrl();
      importPromise = importHandoff(code);
    });
    if (pendingCode) {
      var code = pendingCode;
      pendingCode = null;
      importPromise = importHandoff(code);
    }
  }

  function renderDesktopPanelIfDesktop() {
    if (!device.mobile) renderDesktopPanel();
  }

  window.InnerSanctumDeviceConnect = Object.freeze({
    version: "1.0.0",
    device: device,
    detectDevice: detectDevice,
    providers: HANDOFF_PROVIDERS.slice(),
    whenImported: function () { return importPromise || Promise.resolve(null); }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
