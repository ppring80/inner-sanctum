/*
  THE INNER SANCTUM — CBS MAIN BRIDGE

  Runs inside the CBS page MAIN JavaScript world.

  This is necessary because CBSBrowserConnector may need access to
  CBS page-owned JavaScript objects such as lineupBuilder.

  This file has NO access to chrome.runtime APIs.

  Communication with the isolated extension content script occurs
  through window.postMessage().
*/

(function () {
  "use strict";

  const REQUEST =
    "INNER_SANCTUM_CBS_MAIN_CAPTURE_REQUEST";

  const RESPONSE =
    "INNER_SANCTUM_CBS_MAIN_CAPTURE_RESPONSE";

  function safeError(error) {
    return (
      error?.message ||
      String(error) ||
      "CBS capture failed."
    );
  }

  window.addEventListener(
    "message",
    async function (event) {
      /*
        Only accept messages created by this same page.
      */
      if (
        event.source !== window
      ) {
        return;
      }

      const message =
        event.data;

      if (
        !message ||
        message.type !== REQUEST
      ) {
        return;
      }

      const requestId =
        message.requestId;

      if (!requestId) {
        return;
      }

      try {
        if (
          !window.CBSBrowserConnector
        ) {
          throw new Error(
            "CBS connector is not loaded."
          );
        }

        if (
          typeof window
            .CBSBrowserConnector
            .captureAll !==
          "function"
        ) {
          throw new Error(
            "CBS full league capture is unavailable."
          );
        }

        const captured =
          await window
            .CBSBrowserConnector
            .captureAll();

        window.postMessage(
          {
            type:
              RESPONSE,

            requestId,

            success:
              true,

            data:
              captured
          },
          "*"
        );
      } catch (err) {
        window.postMessage(
          {
            type:
              RESPONSE,

            requestId,

            success:
              false,

            error:
              safeError(err)
          },
          "*"
        );
      }
    }
  );
})();
