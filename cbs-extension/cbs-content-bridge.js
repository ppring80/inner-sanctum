/*
  THE INNER SANCTUM — CBS CONTENT BRIDGE

  Runs in Chrome's isolated extension world on:

      *.football.cbssports.com

  chrome.runtime is available here.

  It asks cbs-main-bridge.js, which runs in the page's MAIN world,
  to execute CBSBrowserConnector.captureAll().

  The sanitized result is then returned to the extension
  service worker.
*/

(function () {
  "use strict";

  const REQUEST =
    "INNER_SANCTUM_CBS_MAIN_CAPTURE_REQUEST";

  const RESPONSE =
    "INNER_SANCTUM_CBS_MAIN_CAPTURE_RESPONSE";

  const TIMEOUT_MS =
    30000;

  function createRequestId() {
    return (
      "cbs-" +
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .slice(2)
    );
  }

  function requestCaptureFromMainWorld() {
    return new Promise(
      function (
        resolve,
        reject
      ) {
        const requestId =
          createRequestId();

        let finished =
          false;

        let timeoutId =
          null;

        function cleanup() {
          window.removeEventListener(
            "message",
            onMessage
          );

          if (timeoutId) {
            clearTimeout(
              timeoutId
            );
          }
        }

        function onMessage(event) {
          if (
            event.source !== window
          ) {
            return;
          }

          const message =
            event.data;

          if (
            !message ||
            message.type !== RESPONSE ||
            message.requestId !== requestId
          ) {
            return;
          }

          if (finished) {
            return;
          }

          finished =
            true;

          cleanup();

          if (
            message.success
          ) {
            resolve(
              message.data
            );
          } else {
            reject(
              new Error(
                message.error ||
                "CBS capture failed."
              )
            );
          }
        }

        window.addEventListener(
          "message",
          onMessage
        );

        window.postMessage(
          {
            type:
              REQUEST,

            requestId
          },
          "*"
        );

        timeoutId =
          setTimeout(
            function () {
              if (finished) {
                return;
              }

              finished =
                true;

              cleanup();

              reject(
                new Error(
                  "CBS capture timed out. Refresh your CBS league page and try again."
                )
              );
            },
            TIMEOUT_MS
          );
      }
    );
  }

  chrome.runtime.onMessage.addListener(
    function (
      message,
      sender,
      sendResponse
    ) {
      if (
        message?.type !==
        "INNER_SANCTUM_CBS_CAPTURE"
      ) {
        return;
      }

      requestCaptureFromMainWorld()
        .then(
          function (captured) {
            sendResponse({
              success:
                true,

              data:
                captured
            });
          }
        )
        .catch(
          function (err) {
            sendResponse({
              success:
                false,

              error:
                err.message ||
                "CBS capture failed."
            });
          }
        );

      return true;
    }
  );
})();
