(function () {
  'use strict';
  var select = document.getElementById('lineupWeek');
  if (!select) return;
  var manual = false;
  var pending = false;
  var timer;
  select.addEventListener('change', function () {
    manual = true;
    clearTimeout(timer);
  });

  async function refresh() {
    if (manual || pending) return;
    pending = true;
    try {
      var response = await fetch('/.netlify/functions/current-nfl-week', { cache: 'no-store' });
      if (!response.ok) throw new Error('Current week unavailable');
      var data = await response.json();
      if (!Number.isInteger(data.week) || data.week < 1 || data.week > 18) throw new Error('Invalid week');
      if (manual) return;
      select.value = String(data.week);
      clearTimeout(timer);
      var next = Date.parse(data.nextRolloverAt);
      if (Number.isFinite(next) && next > Date.now()) {
        timer = setTimeout(refresh, Math.min(next - Date.now() + 1000, 2147483647));
      }
    } catch (_) {
      // Keep the explicit manual choice available; never silently fall back to Week 1.
      if (!manual && !select.value) select.options[0].textContent = 'Select NFL week';
      if (!manual) timer = setTimeout(refresh, 60000);
    } finally {
      pending = false;
    }
  }

  window.addEventListener('focus', refresh);
  refresh();
})();
