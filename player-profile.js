/* ═══════════════════════════════════════════════════════════
   PLAYER PROFILE V1 — shared component
   ═══════════════════════════════════════════════════════════
   Loaded once, shared by every calling page. This file contains NO
   Weekly Rankings or Draft Command Center specific logic, no
   knowledge of flattenRankings()/adpByPos/draftState or any other
   page's data shapes, and does not fetch anything over the network.

   Its only job: given a ProfileModel object (built entirely by the
   calling page's own mapper -- see weekly.html's
   mapWeeklyRowToProfileModel() for the current example), render the
   six-section profile and manage its own open/close lifecycle.

   ProfileModel contract (see /areas/player-profile-v1.md for the
   full design history):

     {
       identity: {                        // REQUIRED
         id, playerID, name, position, team, photoUrl
       },
       verdict: { label, action, confidence, reasons[] } | null,
       rankProjection: { stats: [{label, value}] } | null,
       contextPanel: { title, stats: [{label, value}], note } | null,
       recentForm: { trend: 'up'|'down'|'flat'|null, games: [{label, stats}] } | null,
       risks: string[] | null,
       outlookNote: string | null,
       insight: string | null
     }

   SECTION-OMISSION RULE (the only rule this component implements):
   verdict / rankProjection / contextPanel / recentForm render only
   when the key is a non-null object with at least one populated
   field; risks / outlookNote / insight render only when non-null and
   non-empty. identity always renders; only its own optional inner
   fields (team, photoUrl) are independently hidden. This component
   never asks WHY a section is absent -- that reasoning belongs
   entirely to the calling page's mapper.

   CLOSE-STATE PRESERVATION: this component never touches the calling
   page's own state/table/filters. Closing simply hides the overlay;
   the page underneath was never re-rendered while the profile was
   open, so there is nothing to restore.
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var overlayEl = null;
  var modalEl = null;
  var lastFocusedElement = null;

  function escText(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Separate attribute-value escaper (Fix, deployment review). escText()
  // above is for TEXT NODE content only -- it does not escape quote
  // characters, so using it for an HTML attribute value (e.g. a future
  // photoUrl) would let a value containing `"` break out of the
  // attribute and inject arbitrary markup/attributes. This function is
  // the sole mechanism used for any value placed inside an HTML
  // attribute in this file.
  function escAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  var PROFILE_TITLE_ID = 'pp-profile-title';

  // Focus containment (Fix, deployment review): while the modal is
  // open, Tab/Shift+Tab must cycle only among the modal's own
  // focusable elements, never escape to the page behind it. Purely
  // internal DOM/focus handling -- touches no calling-page state.
  function getFocusableElements() {
    var nodeList = modalEl.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    return Array.prototype.filter.call(nodeList, function (el) {
      return !el.disabled;
    });
  }

  function trapTabKey(e) {
    if (e.key !== 'Tab') return;

    var focusable = getFocusableElements();
    if (!focusable.length) return;

    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function ensureDom() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.className = 'pp-overlay';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    // Connects the dialog to its visible title (the "Player Profile"
    // header, given this same id in render() below) rather than
    // relying on an invisible aria-label duplicate.
    overlayEl.setAttribute('aria-labelledby', PROFILE_TITLE_ID);

    modalEl = document.createElement('div');
    modalEl.className = 'pp-modal';
    overlayEl.appendChild(modalEl);

    document.body.appendChild(overlayEl);

    overlayEl.addEventListener('click', function (e) {
      if (e.target === overlayEl) {
        close();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!overlayEl.classList.contains('pp-open')) return;

      if (e.key === 'Escape') {
        close();
        return;
      }

      trapTabKey(e);
    });
  }

  // A section object is considered "present" only if it has at least
  // one populated field -- an object with every field null/empty
  // counts as absent, exactly like a null section.
  function hasContent(obj, fields) {
    if (!obj || typeof obj !== 'object') return false;
    return fields.some(function (f) {
      var v = obj[f];
      if (Array.isArray(v)) return v.length > 0;
      return v != null && v !== '';
    });
  }

  function renderStatGrid(stats) {
    if (!Array.isArray(stats) || !stats.length) return '';
    return (
      '<div class="pp-stat-grid">' +
      stats
        .map(function (s) {
          return (
            '<div class="pp-stat">' +
            '<span class="pp-stat-label">' + escText(s.label) + '</span>' +
            '<span class="pp-stat-value">' + escText(s.value) + '</span>' +
            '</div>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  function renderIdentity(identity) {
    var photoHtml = identity.photoUrl
      ? '<img class="pp-photo" src="' + escAttr(identity.photoUrl) + '" alt="" />'
      : '';

    var metaParts = [identity.position];
    if (identity.team) metaParts.push(identity.team);

    return (
      '<div class="pp-identity">' +
      photoHtml +
      '<div class="pp-identity-text">' +
      '<div class="pp-name">' + escText(identity.name) + '</div>' +
      '<div class="pp-meta">' + escText(metaParts.filter(Boolean).join(' · ')) + '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function renderVerdict(verdict) {
    if (!hasContent(verdict, ['label', 'action', 'confidence', 'reasons'])) return '';

    var topParts = [];
    if (verdict.label) topParts.push('<span class="pp-verdict-label">' + escText(verdict.label) + '</span>');
    if (verdict.action) topParts.push('<span class="pp-verdict-action">' + escText(verdict.action) + '</span>');
    if (verdict.confidence) topParts.push('<span class="pp-verdict-confidence">' + escText(verdict.confidence) + '</span>');

    var reasonsHtml = Array.isArray(verdict.reasons) && verdict.reasons.length
      ? '<ul class="pp-reasons">' + verdict.reasons.map(function (r) { return '<li>' + escText(r) + '</li>'; }).join('') + '</ul>'
      : '';

    return (
      '<div class="pp-section">' +
      '<div class="pp-section-title">SAGE Verdict</div>' +
      '<div class="pp-verdict-top">' + topParts.join('') + '</div>' +
      reasonsHtml +
      '</div>'
    );
  }

  function renderRankProjection(rankProjection) {
    if (!hasContent(rankProjection, ['stats'])) return '';
    return (
      '<div class="pp-section">' +
      '<div class="pp-section-title">Rank &amp; Projection</div>' +
      renderStatGrid(rankProjection.stats) +
      '</div>'
    );
  }

  function renderContextPanel(contextPanel) {
    if (!contextPanel) return '';
    if (!hasContent(contextPanel, ['stats', 'note']) && !contextPanel.title) return '';
    var noteHtml = contextPanel.note ? '<div class="pp-context-note">' + escText(contextPanel.note) + '</div>' : '';
    return (
      '<div class="pp-section">' +
      '<div class="pp-section-title">' + escText(contextPanel.title || 'This Week') + '</div>' +
      renderStatGrid(contextPanel.stats) +
      noteHtml +
      '</div>'
    );
  }

  function renderRecentForm(recentForm) {
    if (!hasContent(recentForm, ['trend', 'games'])) return '';

    var trendHtml = '';
    if (recentForm.trend) {
      var arrow = recentForm.trend === 'up' ? '↗' : (recentForm.trend === 'down' ? '↘' : '→');
      trendHtml = '<span class="pp-trend pp-trend-' + escText(recentForm.trend) + '">' + arrow + ' ' + escText(recentForm.trend.toUpperCase()) + '</span>';
    }

    var gamesHtml = '';
    if (Array.isArray(recentForm.games) && recentForm.games.length) {
      var statLabels = (recentForm.games[0].stats || []).map(function (s) { return s.label; });
      gamesHtml =
        '<table class="pp-games-table"><thead><tr><th></th>' +
        statLabels.map(function (l) { return '<th>' + escText(l) + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        recentForm.games
          .map(function (g) {
            return (
              '<tr><td>' + escText(g.label) + '</td>' +
              (g.stats || []).map(function (s) { return '<td>' + escText(s.value) + '</td>'; }).join('') +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table>';
    }

    return (
      '<div class="pp-section">' +
      '<div class="pp-section-title">Recent Form ' + trendHtml + '</div>' +
      gamesHtml +
      '</div>'
    );
  }

  function renderRisks(risks, outlookNote) {
    var hasRisks = Array.isArray(risks) && risks.length > 0;
    if (!hasRisks && !outlookNote) return '';

    var listHtml = hasRisks
      ? '<ul class="pp-risk-list">' + risks.map(function (r) { return '<li>' + escText(r) + '</li>'; }).join('') + '</ul>'
      : '';
    var outlookHtml = outlookNote ? '<div class="pp-outlook-note">' + escText(outlookNote) + '</div>' : '';

    return (
      '<div class="pp-section">' +
      '<div class="pp-section-title">Risks / Watch</div>' +
      listHtml +
      outlookHtml +
      '</div>'
    );
  }

  function renderInsight(insight) {
    if (!insight) return '';
    return '<div class="pp-insight">' + escText(insight) + '</div>';
  }

  function render(model) {
    var sectionsHtml = [
      renderVerdict(model.verdict),
      renderRankProjection(model.rankProjection),
      renderContextPanel(model.contextPanel),
      renderRecentForm(model.recentForm),
      renderRisks(model.risks, model.outlookNote),
      renderInsight(model.insight)
    ].join('');

    modalEl.innerHTML =
      '<div class="pp-header">' +
      '<span class="pp-header-title" id="' + PROFILE_TITLE_ID + '">Player Profile</span>' +
      '<button type="button" class="pp-close" aria-label="Close">✕</button>' +
      '</div>' +
      '<div class="pp-body">' +
      renderIdentity(model.identity) +
      sectionsHtml +
      '</div>';

    modalEl.querySelector('.pp-close').addEventListener('click', close);
  }

  function open(model) {
    if (!model || !model.identity || !model.identity.name) return;

    ensureDom();
    render(model);

    lastFocusedElement = document.activeElement;
    overlayEl.classList.add('pp-open');

    var closeBtn = modalEl.querySelector('.pp-close');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    if (!overlayEl) return;
    overlayEl.classList.remove('pp-open');

    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
    lastFocusedElement = null;
  }

  window.PlayerProfile = {
    open: open,
    close: close
  };
})();
