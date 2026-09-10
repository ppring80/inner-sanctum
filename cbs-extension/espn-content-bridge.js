/*
  THE INNER SANCTUM — ESPN CONTENT BRIDGE

  Runs in the extension's isolated world on fantasy.espn.com and relays a
  sanitized capture request to espn-main-bridge.js in the ESPN page world.
*/

(function () {
  "use strict";

  const extensionApi = globalThis.browser || globalThis.chrome;
  const REQUEST = "INNER_SANCTUM_ESPN_MAIN_CAPTURE_REQUEST";
  const RESPONSE = "INNER_SANCTUM_ESPN_MAIN_CAPTURE_RESPONSE";
  const TIMEOUT_MS = 30000;

  function createRequestId() {
    return "espn-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }

  function requestCaptureFromMainWorld() {
    return new Promise(function (resolve, reject) {
      const requestId = createRequestId();
      let finished = false;
      let timeoutId = null;

      function cleanup() {
        window.removeEventListener("message", onMessage);
        if (timeoutId) clearTimeout(timeoutId);
      }

      function onMessage(event) {
        if (event.source !== window) return;
        const message = event.data;
        if (!message || message.type !== RESPONSE || message.requestId !== requestId || finished) return;

        finished = true;
        cleanup();

        if (message.success) {
          resolve(message.data);
        } else {
          reject(new Error(message.error || "ESPN capture failed."));
        }
      }

      window.addEventListener("message", onMessage);
      window.postMessage({ type: REQUEST, requestId: requestId }, "*");

      timeoutId = setTimeout(function () {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new Error("ESPN capture timed out. Open your ESPN league and try again."));
      }, TIMEOUT_MS);
    });
  }

  if (!extensionApi?.runtime?.onMessage) return;

  extensionApi.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message?.type !== "INNER_SANCTUM_ESPN_CAPTURE") return;

    requestCaptureFromMainWorld()
      .then(function (captured) {
        sendResponse({ success: true, data: captured });
      })
      .catch(function (err) {
        sendResponse({ success: false, error: err.message || "ESPN capture failed." });
      });

    return true;
  });
})();
