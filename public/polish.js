// Phase 10 polish features: shortcuts, help overlay, feedback button,
// last-updated timestamps, global search (Cmd+K)
// Loaded automatically on all pages via auth.js → renderGlobalHeader

(function() {
  // ========== 10.3 Keyboard shortcuts help overlay ==========
  var helpHTML = `
    <div id="kbd-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center">
      <div style="background:#151822;border:1px solid #2a2f3d;border-radius:12px;padding:24px 28px;width:420px;max-width:92vw;color:#f0f2f8">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="font-size:16px;font-weight:700;margin:0">Keyboard Shortcuts</h3>
          <button onclick="document.getElementById('kbd-overlay').style.display='none'" style="background:none;border:none;color:#7a8497;cursor:pointer;font-size:20px">&times;</button>
        </div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:10px 20px;font-size:13px">
          <span>Open AI assistant</span><span><kbd>/</kbd></span>
          <span>Global search</span><span><kbd>⌘</kbd> + <kbd>K</kbd></span>
          <span>Focus date picker</span><span><kbd>d</kbd></span>
          <span>Close overlay / panel</span><span><kbd>Esc</kbd></span>
          <span>Show this help</span><span><kbd>?</kbd></span>
        </div>
      </div>
    </div>
    <style>
      #kbd-overlay kbd { display:inline-block;padding:2px 7px;background:#2a2f3d;border-radius:4px;font-family:monospace;font-size:11px;color:#b0b8c4;border:1px solid #3a4050 }
    </style>`;
  document.addEventListener('DOMContentLoaded', function() {
    document.body.insertAdjacentHTML('beforeend', helpHTML);
  });

  // ========== 10.6 Feedback button (in user menu area) ==========
  window.openFeedback = function() {
    var subject = encodeURIComponent('Finance Dashboard Feedback');
    var body = encodeURIComponent('Page: ' + window.location.pathname + '\n\nYour feedback:\n');
    window.open('mailto:ryan@xterio.com?subject=' + subject + '&body=' + body);
  };

  // ========== 10.2 Global search (Cmd+K) ==========
  var searchItems = [
    { label: 'Overview', url: '/', icon: '📊' },
    { label: 'Reports', url: '/reports.html', icon: '📋' },
    { label: 'Cash', url: '/cash.html', icon: '💰' },
    { label: 'Cash Position', url: '/cash-position.html', icon: '💵' },
    { label: 'Consolidated Balance Sheet', url: '/consolidated-bs.html', icon: '📑' },
    { label: 'IC Detail', url: '/ic-detail.html', icon: '🔗' },
    { label: 'IC Reconciliation', url: '/ic-recon.html', icon: '⚖' },
    { label: 'Reconciliation', url: '/reconciliation.html', icon: '✓' },
    { label: 'Tasks (Kanban)', url: '/kanban.html', icon: '✅' },
    { label: 'Balance Sheet', url: '/balance-sheet.html', icon: '⚖' },
    { label: 'Cash Flow', url: '/cash-flow.html', icon: '↔' },
    { label: 'Xterio Foundation', url: '/xterio.html', icon: '🏦' },
    { label: 'Admin', url: '/admin.html', icon: '⚙' },
  ];
  var searchHTML = `
    <div id="gs-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10001;align-items:flex-start;justify-content:center;padding-top:20vh">
      <div style="background:#151822;border:1px solid #2a2f3d;border-radius:12px;width:520px;max-width:92vw;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.5)">
        <input id="gs-input" type="text" placeholder="Search pages, entities, accounts..." autocomplete="off" style="width:100%;padding:16px 20px;background:none;border:none;border-bottom:1px solid #2a2f3d;color:#f0f2f8;font-size:15px;outline:none">
        <div id="gs-results" style="max-height:360px;overflow-y:auto"></div>
        <div style="padding:8px 16px;border-top:1px solid #2a2f3d;font-size:10px;color:#7a8497;display:flex;justify-content:space-between">
          <span>↑↓ Navigate · ↵ Open · Esc Close</span>
          <span>Press <kbd style="padding:1px 5px;background:#2a2f3d;border-radius:3px;font-family:monospace">?</kbd> for shortcuts</span>
        </div>
      </div>
    </div>`;
  document.addEventListener('DOMContentLoaded', function() {
    document.body.insertAdjacentHTML('beforeend', searchHTML);
    renderSearchResults('');
    document.getElementById('gs-input').addEventListener('input', function(e) {
      renderSearchResults(e.target.value);
    });
    document.getElementById('gs-input').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        var first = document.querySelector('#gs-results .gs-item');
        if (first) first.click();
      }
    });
  });

  function renderSearchResults(q) {
    var el = document.getElementById('gs-results');
    if (!el) return;
    var query = (q || '').toLowerCase();
    var filtered = query ? searchItems.filter(function(it) { return it.label.toLowerCase().includes(query); }) : searchItems;
    el.innerHTML = filtered.length === 0
      ? '<div style="padding:20px;color:#7a8497;text-align:center;font-size:13px">No matches</div>'
      : filtered.map(function(it) {
          return '<a href="' + it.url + '" class="gs-item" style="display:flex;gap:12px;padding:12px 20px;color:#f0f2f8;text-decoration:none;font-size:13px;border-bottom:1px solid #1f2330"><span style="width:24px">' + it.icon + '</span><span>' + it.label + '</span></a>';
        }).join('');
  }

  window.toggleGlobalSearch = function() {
    var overlay = document.getElementById('gs-overlay');
    if (!overlay) return;
    if (overlay.style.display === 'none' || !overlay.style.display) {
      overlay.style.display = 'flex';
      var input = document.getElementById('gs-input');
      if (input) { input.value = ''; input.focus(); renderSearchResults(''); }
    } else {
      overlay.style.display = 'none';
    }
  };

  // ========== 10.1 Last-updated timestamps helper ==========
  function relativeTime(iso) {
    if (!iso) return '';
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
    return Math.floor(diff / 86400) + ' days ago';
  }
  function refreshTimestamps() {
    document.querySelectorAll('[data-updated]').forEach(function(el) {
      el.textContent = 'Last updated: ' + relativeTime(el.dataset.updated);
    });
  }
  window.updateTimestamp = function(selector, iso) {
    var el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (el) { el.dataset.updated = iso || new Date().toISOString(); el.textContent = 'Last updated: ' + relativeTime(el.dataset.updated); }
  };
  setInterval(refreshTimestamps, 60000);

  // ========== 10.3 Global keyboard shortcuts ==========
  document.addEventListener('keydown', function(e) {
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    var isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);

    // ? opens help (when not typing)
    if (e.key === '?' && !isTyping && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      var o = document.getElementById('kbd-overlay');
      if (o) o.style.display = o.style.display === 'none' || !o.style.display ? 'flex' : 'none';
    }
    // Cmd/Ctrl+K opens global search
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      window.toggleGlobalSearch();
    }
    // d focuses date picker (when not typing)
    if (e.key === 'd' && !isTyping && !e.metaKey && !e.ctrlKey) {
      var dateInput = document.getElementById('asOfDate');
      if (dateInput) { e.preventDefault(); dateInput.focus(); }
    }
    // Esc closes overlays
    if (e.key === 'Escape') {
      var kbd = document.getElementById('kbd-overlay');
      var gs = document.getElementById('gs-overlay');
      if (kbd && kbd.style.display === 'flex') kbd.style.display = 'none';
      if (gs && gs.style.display === 'flex') gs.style.display = 'none';
    }
  });

  // Click outside to close overlays
  document.addEventListener('click', function(e) {
    ['kbd-overlay', 'gs-overlay'].forEach(function(id) {
      var o = document.getElementById(id);
      if (o && e.target === o) o.style.display = 'none';
    });
  });
})();