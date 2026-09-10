/*
  THE INNER SANCTUM — weekly-lineup-polish.js
  ------------------------------------------------
  Presentation-only enhancements for Weekly Rankings.

  Goals:
    - Make My Roster Only read like a lineup decision screen.
    - Keep Week Snapshot scoped to the customer's roster when that mode is on.
    - Preserve the existing Weekly SAGE ranking/lineup logic as the source of truth.
    - Reconcile the displayed SAGE action sentence with the personalized lineup
      decision without changing the underlying player/week outlook.
    - Avoid changing ranking scores or recommendation calculations.
*/
(function (root) {
  "use strict";

  const ACTION_SENTENCES = [
    /Keep him locked in\.?/gi,
    /Keep [A-Z]{2,4} locked in\.?/gi,
    /Confident start\.?/gi,
    /Still a Week 1 start\.?/gi,
    /Solid start(?:, with slightly lower confidence)?\.?/gi,
    /Worth flex consideration(?:, with slightly lower confidence)?\.?/gi,
    /Best as a depth option this week(?:, with slightly lower confidence)?\.?/gi
  ];

  function stripRawAction(text) {
    let result = String(text || "").trim();
    ACTION_SENTENCES.forEach(function (pattern) {
      result = result.replace(pattern, "").trim();
    });
    return result.replace(/\s{2,}/g, " ").trim();
  }

  function rosterActionSentence(assignment) {
    if (!assignment || assignment.call !== "start") {
      return "A stronger roster option keeps him on your bench this week.";
    }
    if (assignment.slot === "FLEX" || assignment.slot === "SUPERFLEX") {
      return "He still earns a " + assignment.slot + " spot in your lineup this week.";
    }
    return "He still belongs in your starting lineup this week.";
  }

  function reconcileSageTake(text, assignment) {
    if (!assignment) return String(text || "");
    const outlook = stripRawAction(text);
    const action = rosterActionSentence(assignment);
    return [outlook, action].filter(Boolean).join(" ").trim();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      stripRawAction: stripRawAction,
      rosterActionSentence: rosterActionSentence,
      reconcileSageTake: reconcileSageTake
    };
  }

  if (!root || !root.location || !/^\/weekly(?:\.html)?\/?$/i.test(root.location.pathname)) return;

  const window = root;
  if (typeof window.renderTable !== "function" || typeof window.renderWeekSnapshot !== "function") return;

  const SLOT_ORDER = {
    QB: 0,
    RB: 1,
    WR: 2,
    TE: 3,
    FLEX: 4,
    SUPERFLEX: 5,
    K: 6,
    DEF: 7,
    BENCH: 8
  };

  const POS_ORDER = {
    QB: 0,
    RB: 1,
    WR: 2,
    TE: 3,
    K: 4,
    DEF: 5
  };

  function injectStyles() {
    if (document.getElementById("weekly-lineup-polish-styles")) return;

    const style = document.createElement("style");
    style.id = "weekly-lineup-polish-styles";
    style.textContent = [
      ".lineup-section-row td{background:var(--bg2);border-top:2px solid var(--border2);border-bottom:1px solid var(--border);padding:8px 14px!important;font-family:'JetBrains Mono',monospace;font-size:10px!important;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:var(--muted)!important}",
      ".lineup-section-row.starting td{color:var(--green)!important}",
      ".lineup-section-row.bench td{color:var(--dim)!important}",
      ".lineup-cell-slot{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--muted);white-space:nowrap}",
      ".lineup-cell-slot.start{color:var(--green)}",
      ".lineup-cell-slot.bench{color:var(--dim)}"
    ].join("\n");
    document.head.appendChild(style);
  }

  function rowPlayerName(row) {
    const el = row.querySelector(".cell-name");
    return el ? el.textContent.trim() : "";
  }

  function allRowsByName() {
    const map = {};
    if (typeof window.getAllRows !== "function") return map;
    window.getAllRows().forEach(function (player) {
      if (player && player.name) map[player.name] = player;
    });
    return map;
  }

  function assignmentFor(name, assignments) {
    return assignments && assignments[name] ? assignments[name] : { call: "sit", slot: "BENCH" };
  }

  function reorderRosterRows() {
    if (!window.state || !window.state.myRosterOnly) return;
    if (typeof window.getRosterLineupAssignments !== "function") return;

    const tbody = document.getElementById("rankTableBody");
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll("tr")).filter(function (row) {
      return !row.classList.contains("lineup-section-row");
    });
    if (!rows.length) return;

    const assignments = window.getRosterLineupAssignments();
    const players = allRowsByName();

    const entries = rows.map(function (row, index) {
      const name = rowPlayerName(row);
      const assignment = assignmentFor(name, assignments);
      const player = players[name] || {};
      return { row: row, index: index, name: name, assignment: assignment, player: player };
    });

    const starters = entries.filter(function (entry) {
      return entry.assignment.call === "start";
    });
    const bench = entries.filter(function (entry) {
      return entry.assignment.call !== "start";
    });

    starters.sort(function (a, b) {
      const aSlot = SLOT_ORDER[a.assignment.slot] ?? 99;
      const bSlot = SLOT_ORDER[b.assignment.slot] ?? 99;
      if (aSlot !== bSlot) return aSlot - bSlot;
      const aPos = POS_ORDER[a.player.pos] ?? 99;
      const bPos = POS_ORDER[b.player.pos] ?? 99;
      if (aPos !== bPos) return aPos - bPos;
      const aValue = typeof window.lineupRankingValue === "function" ? window.lineupRankingValue(a.player) : 0;
      const bValue = typeof window.lineupRankingValue === "function" ? window.lineupRankingValue(b.player) : 0;
      if (aValue !== bValue) return bValue - aValue;
      return a.index - b.index;
    });

    bench.sort(function (a, b) {
      const aPos = POS_ORDER[a.player.pos] ?? 99;
      const bPos = POS_ORDER[b.player.pos] ?? 99;
      if (aPos !== bPos) return aPos - bPos;
      const aValue = typeof window.lineupRankingValue === "function" ? window.lineupRankingValue(a.player) : 0;
      const bValue = typeof window.lineupRankingValue === "function" ? window.lineupRankingValue(b.player) : 0;
      if (aValue !== bValue) return bValue - aValue;
      return a.index - b.index;
    });

    tbody.innerHTML = "";

    function appendSection(label, className, list) {
      if (!list.length) return;
      const divider = document.createElement("tr");
      divider.className = "lineup-section-row " + className;
      divider.innerHTML = '<td colspan="6">' + label + "</td>";
      tbody.appendChild(divider);

      list.forEach(function (entry) {
        const firstCell = entry.row.querySelector("td");
        if (firstCell) {
          const isStart = entry.assignment.call === "start";
          const labelText = isStart ? entry.assignment.slot : "BENCH";
          firstCell.innerHTML = '<span class="lineup-cell-slot ' + (isStart ? "start" : "bench") + '">' + labelText + "</span>";
        }
        tbody.appendChild(entry.row);
      });
    }

    appendSection("Starting Lineup", "starting", starters);
    appendSection("Bench & Alternatives", "bench", bench);

    const header = document.querySelector(".rank-table thead th:first-child");
    if (header) header.textContent = "Lineup";
  }

  function restoreRankHeader() {
    const header = document.querySelector(".rank-table thead th:first-child");
    if (header && (!window.state || !window.state.myRosterOnly)) header.textContent = "Rank";
  }

  function polishDefenseCopy() {
    const tbody = document.getElementById("rankTableBody");
    if (!tbody) return;

    Array.from(tbody.querySelectorAll("tr")).forEach(function (row) {
      const pos = row.querySelector(".pos-pill.DEF");
      if (!pos) return;
      const teamEl = row.querySelector(".cell-team");
      const verdict = row.querySelector(".cell-verdict");
      if (!teamEl || !verdict) return;
      const team = teamEl.textContent.trim();
      verdict.childNodes.forEach(function (node) {
        if (node.nodeType !== Node.TEXT_NODE) return;
        node.textContent = node.textContent.replace(/Keep him locked in\.?/gi, "Keep " + team + " locked in.");
      });
    });
  }

  function reconcileRosterSageTake() {
    if (!window.state || !window.state.myRosterOnly) return;
    if (typeof window.getRosterLineupAssignments !== "function") return;

    const tbody = document.getElementById("rankTableBody");
    if (!tbody) return;
    const assignments = window.getRosterLineupAssignments();

    Array.from(tbody.querySelectorAll("tr")).forEach(function (row) {
      if (row.classList.contains("lineup-section-row")) return;
      const nameEl = row.querySelector(".cell-name");
      const verdict = row.querySelector(".cell-verdict");
      if (!nameEl || !verdict) return;
      const assignment = assignments[nameEl.textContent.trim()];
      if (!assignment) return;

      const textNodes = Array.from(verdict.childNodes).filter(function (node) {
        return node.nodeType === Node.TEXT_NODE;
      });
      if (!textNodes.length) return;

      const rawText = textNodes.map(function (node) { return node.textContent; }).join(" ").trim();
      const reconciled = reconcileSageTake(rawText, assignment);
      textNodes[0].textContent = reconciled ? " " + reconciled : "";
      for (let i = 1; i < textNodes.length; i++) textNodes[i].textContent = "";
    });
  }

  function personalizedSnapshot() {
    if (!window.state || !window.state.myRosterOnly) return false;
    if (typeof window.getAllRows !== "function" || typeof window.getRosterLineupAssignments !== "function") return false;

    const panel = document.getElementById("weekSnapshotList");
    if (!panel) return true;

    const rosterNames = new Set(window.state.myRosterNames || []);
    const mine = window.getAllRows().filter(function (player) {
      return rosterNames.has(player.name);
    });
    const assignments = window.getRosterLineupAssignments();
    const starters = mine.filter(function (player) {
      return assignments[player.name] && assignments[player.name].call === "start";
    });
    const bench = mine.filter(function (player) {
      return !assignments[player.name] || assignments[player.name].call !== "start";
    });

    const week = typeof window.getSelectedWeek === "function" ? window.getSelectedWeek() : 1;
    const scoring = typeof window.getScoringFormat === "function" ? window.getScoringFormat() : "ppr";
    const scoringLabel = { ppr: "PPR", half: "Half PPR", standard: "Standard" }[scoring] || scoring;

    function bestByValue(list) {
      if (!list.length) return null;
      return list.reduce(function (best, player) {
        const current = typeof window.lineupRankingValue === "function" ? window.lineupRankingValue(player) : -Infinity;
        const bestValue = typeof window.lineupRankingValue === "function" ? window.lineupRankingValue(best) : -Infinity;
        return current > bestValue ? player : best;
      });
    }

    const topRoster = bestByValue(mine);
    const topStarter = bestByValue(starters);
    const topBench = bestByValue(bench);
    let html = "";

    function item(label, value, sub) {
      if (!value) return;
      html += '<div class="week-snapshot-item">' +
        '<div class="week-snapshot-label">' + label + "</div>" +
        '<div class="week-snapshot-value">' + value + "</div>" +
        (sub ? '<div class="week-snapshot-sub">' + sub + "</div>" : "") +
        "</div>";
    }

    if (topRoster) {
      item(week === 1 ? "Top On My Roster" : "Top Weekly SAGE On My Roster", topRoster.name, topRoster.pos);
    }
    if (topStarter) {
      const slot = assignments[topStarter.name] ? assignments[topStarter.name].slot : topStarter.pos;
      item("Strongest Recommended Start", topStarter.name, slot + (topStarter.opp && topStarter.opp !== "—" ? " · vs " + topStarter.opp : ""));
    }
    if (topBench) {
      item("Closest Bench Alternative", topBench.name, topBench.pos + (topBench.opp && topBench.opp !== "—" ? " · vs " + topBench.opp : ""));
    }
    item("Format & Week", scoringLabel + " · Week " + week, "Personalized to My Roster");

    panel.innerHTML = html;
    return true;
  }

  injectStyles();

  const baseRenderWeekSnapshot = window.renderWeekSnapshot;
  window.renderWeekSnapshot = function () {
    if (personalizedSnapshot()) return;
    return baseRenderWeekSnapshot.apply(this, arguments);
  };

  const baseRenderTable = window.renderTable;
  window.renderTable = function () {
    const result = baseRenderTable.apply(this, arguments);
    restoreRankHeader();
    reorderRosterRows();
    polishDefenseCopy();
    reconcileRosterSageTake();
    return result;
  };

  window.reconcileWeeklySageTake = reconcileSageTake;
  window.renderTable();
})(typeof window !== "undefined" ? window : null);