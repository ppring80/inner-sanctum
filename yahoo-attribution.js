/*
  THE INNER SANCTUM — yahoo-attribution.js
  --------------------------------------------
  Required by the signed Yahoo API Access and Use Agreement:
  any page displaying Yahoo Fantasy data must show "Fantasy data
  provided by Yahoo Fantasy" in the footer, hyperlinked to an
  official Yahoo Fantasy page.

  <script src="league-connection.js"></script>
  <script src="yahoo-attribution.js"></script>
  ...
  <div id="yahoo-attribution"></div>
  <script>renderYahooAttribution("yahoo-attribution");</script>

  Renders nothing unless the active connected provider is Yahoo —
  safe to include on every page, stays silent for Sleeper users.
*/

function renderYahooAttribution(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const activeProvider = window.LeagueConnection
    ? window.LeagueConnection.getActiveProvider()
    : null;

  if (activeProvider !== "yahoo") {
    container.innerHTML = "";
    return;
  }

  container.innerHTML =
    '<div style="text-align:center;padding:20px 0;font-size:12px;color:#6B6355;">' +
    "Fantasy data provided by " +
    '<a href="https://football.fantasysports.yahoo.com/" target="_blank" rel="noopener noreferrer" style="color:#C9A24B;text-decoration:underline;">Yahoo Fantasy</a>' +
    "</div>";
}
