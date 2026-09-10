/*
  THE INNER SANCTUM — weekly-sage-take-reconciliation.js
  ------------------------------------------------------
  Presentation-only reconciliation between Weekly SAGE's player/week outlook
  and the customer's personalized lineup assignment.

  This never changes SAGE scores, rankings, matchup labels, raw sageTake text,
  or lineup assignments. It only replaces the action sentence shown in My
  Roster Only mode so the explanation can preserve a difficult outlook while
  still explaining the roster-specific START/FLEX/BENCH decision.
*/
(function (root) {
  'use strict';

  var ACTION_SENTENCES = [
    /Keep him locked in\.?/gi,
    /Confident start\.?/gi,
    /Still a Week 1 start\.?/gi,
    /Solid start(?:, with slightly lower confidence)?\.?/gi,
    /Worth flex consideration(?:, with slightly lower confidence)?\.?/gi,
    /Best as a depth option this week(?:, with slightly lower confidence)?\.?/gi
  ];

  function stripRawAction(text) {
    var result = String(text || '').trim();
    ACTION_SENTENCES.forEach(function (pattern) {
      result = result.replace(pattern, '').trim();
    });
    return result.replace(/\s{2,}/g, ' ').trim();
  }

  function rosterActionSentence(assignment) {
    if (!assignment || assignment.call !== 'start') {
      return 'A stronger roster option keeps him on your bench this week.';
    }
    if (assignment.slot === 'FLEX' || assignment.slot === 'SUPERFLEX') {
      return 'He still earns a ' + assignment.slot + ' spot in your lineup this week.';
    }
    return 'He still belongs in your starting lineup this week.';
  }

  function reconcileSageTake(text, assignment) {
    if (!assignment) return String(text || '');
    var outlook = stripRawAction(text);
    var action = rosterActionSentence(assignment);
    return [outlook, action].filter(Boolean).join(' ').trim();
  }

  function applyToTable() {
    if (!root.state || !root.state.myRosterOnly) return;
    if (typeof root.getRosterLineupAssignments !== 'function') return;

    var tbody = document.getElementById('rankTableBody');
    if (!tbody) return;
    var assignments = root.getRosterLineupAssignments();

    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (row) {
      if (row.classList.contains('lineup-section-row')) return;
      var nameEl = row.querySelector('.cell-name');
      var verdict = row.querySelector('.cell-verdict');
      if (!nameEl || !verdict) return;
      var assignment = assignments[nameEl.textContent.trim()];
      if (!assignment) return;

      var textNodes = Array.prototype.filter.call(verdict.childNodes, function (node) {
        return node.nodeType === Node.TEXT_NODE;
      });
      if (!textNodes.length) return;
      var rawText = textNodes.map(function (node) { return node.textContent; }).join(' ').trim();
      var reconciled = reconcileSageTake(rawText, assignment);
      textNodes[0].textContent = reconciled ? ' ' + reconciled : '';
      for (var i = 1; i < textNodes.length; i++) textNodes[i].textContent = '';
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      stripRawAction: stripRawAction,
      rosterActionSentence: rosterActionSentence,
      reconcileSageTake: reconcileSageTake
    };
  }

  if (typeof window === 'undefined' || !/^\/weekly(?:\.html)?\/?$/i.test(window.location.pathname)) return;
  if (typeof window.renderTable !== 'function') return;
  if (window.renderTable.__innerSanctumSageTakeReconciled) return;

  var baseRenderTable = window.renderTable;
  function wrappedRenderTable() {
    var result = baseRenderTable.apply(this, arguments);
    applyToTable();
    return result;
  }
  wrappedRenderTable.__innerSanctumSageTakeReconciled = true;
  window.renderTable = wrappedRenderTable;
  window.reconcileWeeklySageTake = reconcileSageTake;
  window.renderTable();
})(typeof window !== 'undefined' ? window : globalThis);
