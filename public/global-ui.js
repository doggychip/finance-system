// Global UI: progressive-enhancement layer.
// - Does NOT replace each page's .nav or .actions.
// - Adds: user menu, i18n toggle, nav nowrap CSS, and a value-sync
//   layer that keeps every page's existing #asOfDate input in sync
//   via localStorage + URL param (?as_of_date=YYYY-MM-DD).
// Loaded on all pages after auth.js.

(function() {
  // ========== i18n ==========
  var TRANSLATIONS = {
    en: {
      'menu.change_password': 'Change Password', 'menu.admin': 'Admin',
      'menu.logout': 'Logout', 'menu.language': 'Language',
    },
    zh: {
      'menu.change_password': '修改密码', 'menu.admin': '管理',
      'menu.logout': '登出', 'menu.language': '语言',
    }
  };

  window.getLang = function() {
    return localStorage.getItem('finance_lang') || 'en';
  };
  window.setLang = function(lang) {
    localStorage.setItem('finance_lang', lang);
    location.reload();
  };
  window.t = function(key) {
    var lang = window.getLang();
    return (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) || TRANSLATIONS.en[key] || key;
  };

  // ========== Global date state (sync layer) ==========
  var DATE_KEY = 'finance_as_of_date';
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  window.getGlobalDate = function() {
    var urlDate = new URLSearchParams(window.location.search).get('as_of_date');
    if (urlDate && DATE_RE.test(urlDate)) return urlDate;
    var stored = localStorage.getItem(DATE_KEY);
    return stored && DATE_RE.test(stored) ? stored : '';
  };

  window.setGlobalDate = function(date) {
    if (!date || !DATE_RE.test(date)) return;
    localStorage.setItem(DATE_KEY, date);
    var url = new URL(window.location);
    if (url.searchParams.get('as_of_date') !== date) {
      url.searchParams.set('as_of_date', date);
      window.history.replaceState({}, '', url);
    }
  };

  // Sync layer: seed the page's existing #asOfDate from global state,
  // and listen for user changes to write them back to global state.
  // Safe no-op on pages without an #asOfDate element.
  function installDateSync() {
    var el = document.getElementById('asOfDate');
    if (!el) return;
    var globalDate = window.getGlobalDate();

    // If the user has picked a global date, apply it to this page's input.
    // For <select>, only set if the matching option already exists; otherwise
    // leave the page's own init (e.g. loadSnapshots) to populate and choose.
    if (globalDate) {
      if (el.tagName === 'SELECT') {
        var hasOption = Array.prototype.some.call(el.options, function(o) {
          return o.value === globalDate;
        });
        if (hasOption) el.value = globalDate;
      } else {
        el.value = globalDate;
      }
    }

    el.addEventListener('change', function() {
      if (el.value && DATE_RE.test(el.value)) {
        window.setGlobalDate(el.value);
      }
    });
  }

  // For <select id="asOfDate"> (cash.html, cash-position.html) the options
  // are injected asynchronously. Retry seeding once options appear.
  function observeAsyncSelect() {
    var el = document.getElementById('asOfDate');
    if (!el || el.tagName !== 'SELECT') return;
    if (el.options.length > 0) return;
    var mo = new MutationObserver(function() {
      if (el.options.length > 0) {
        mo.disconnect();
        var globalDate = window.getGlobalDate();
        if (globalDate) {
          var hasOption = Array.prototype.some.call(el.options, function(o) {
            return o.value === globalDate;
          });
          if (hasOption) el.value = globalDate;
        }
      }
    });
    mo.observe(el, { childList: true });
  }

  // ========== User menu (additive) ==========
  // Injected into .header WITHOUT removing existing .nav or .actions.
  function injectUserMenu() {
    var header = document.querySelector('.header');
    if (!header) return;
    if (document.getElementById('user-menu')) return; // already present

    var user = window.getUser && window.getUser();
    if (!user) return;

    var lang = window.getLang();
    var wrap = document.createElement('div');
    wrap.id = 'user-menu';
    wrap.style.cssText = 'position:relative;margin-left:8px;flex-shrink:0;';
    wrap.innerHTML =
      '<button id="userBtn" type="button" aria-haspopup="menu" style="display:flex;align-items:center;gap:6px;padding:5px 10px;background:#232734;border:1px solid #2e3344;border-radius:20px;color:#e4e6ef;font-size:12px;cursor:pointer">' +
        '<span style="width:22px;height:22px;border-radius:50%;background:#6366f1;color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px">' + (user.display_name || user.username || 'U').charAt(0).toUpperCase() + '</span>' +
        '<span style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (user.display_name || user.username) + '</span>' +
        '<span style="color:#8b8fa3">▾</span>' +
      '</button>' +
      '<div id="userDropdown" role="menu" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;background:#1a1d27;border:1px solid #2e3344;border-radius:8px;min-width:200px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:100;overflow:hidden">' +
        (user.role === 'admin' ? '<a href="/admin.html" class="menu-item" style="display:block;padding:10px 14px;color:#e4e6ef;text-decoration:none;font-size:12px;border-bottom:1px solid #2e3344">⚙ ' + window.t('menu.admin') + '</a>' : '') +
        '<button type="button" onclick="openPasswordModal();toggleUserMenu()" class="menu-item" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;color:#e4e6ef;font-size:12px;cursor:pointer;border-bottom:1px solid #2e3344">🔒 ' + window.t('menu.change_password') + '</button>' +
        '<div class="menu-item" style="padding:10px 14px;font-size:12px;border-bottom:1px solid #2e3344;color:#8b8fa3">' + window.t('menu.language') + ': ' +
          '<button type="button" onclick="setLang(\'en\')" style="padding:2px 8px;margin-left:4px;background:' + (lang === 'en' ? '#6366f1' : 'transparent') + ';color:' + (lang === 'en' ? 'white' : '#e4e6ef') + ';border:1px solid #2e3344;border-radius:4px;font-size:11px;cursor:pointer">EN</button> ' +
          '<button type="button" onclick="setLang(\'zh\')" style="padding:2px 8px;background:' + (lang === 'zh' ? '#6366f1' : 'transparent') + ';color:' + (lang === 'zh' ? 'white' : '#e4e6ef') + ';border:1px solid #2e3344;border-radius:4px;font-size:11px;cursor:pointer">中文</button>' +
        '</div>' +
        '<button type="button" onclick="logout()" class="menu-item" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;color:#ef4444;font-size:12px;cursor:pointer">→ ' + window.t('menu.logout') + '</button>' +
      '</div>';

    header.appendChild(wrap);

    document.addEventListener('click', function(e) {
      var dropdown = document.getElementById('userDropdown');
      var btn = document.getElementById('userBtn');
      if (dropdown && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  }

  window.toggleUserMenu = function() {
    var d = document.getElementById('userDropdown');
    if (d) d.style.display = d.style.display === 'none' || !d.style.display ? 'block' : 'none';
  };

  // Kept for backward compatibility with auth.js, which calls
  // renderGlobalHeader(activePage) after login. Now a no-op for nav/actions:
  // we don't touch them. Just mark the active link and inject the user menu.
  window.renderGlobalHeader = function(activePage) {
    var nav = document.querySelector('.header .nav');
    if (nav && activePage) {
      // Normalize active state based on href. Does not rebuild the nav.
      var hrefMap = {
        overview: '/', reports: '/reports.html', cash: '/cash.html',
        consolidated: '/consolidated-bs.html', ic_detail: '/ic-detail.html',
        reconciliation: '/reconciliation.html', tasks: '/kanban.html'
      };
      var target = hrefMap[activePage];
      if (target) {
        nav.querySelectorAll('a').forEach(function(a) {
          var href = a.getAttribute('href') || '';
          a.classList.toggle('active', href === target);
        });
      }
    }
    injectUserMenu();
    installDateSync();
    observeAsyncSelect();
  };

  // ========== Nav nowrap + compact padding CSS ==========
  var style = document.createElement('style');
  style.textContent =
    '.header { flex-wrap: nowrap !important; gap: 16px; }' +
    '.header h1 { flex-shrink: 0; }' +
    '.nav { flex-wrap: nowrap !important; min-width: 0; overflow: hidden; }' +
    '.nav a { white-space: nowrap; flex-shrink: 0; }' +
    '.actions { flex-shrink: 0; }' +
    '@media (max-width: 1299px) { .nav a { padding: 6px 10px !important; font-size: 12px !important; } }' +
    '@media (max-width: 1199px) { .nav a { padding: 5px 8px !important; font-size: 12px !important; } .nav { gap: 1px !important; } }' +
    '@media (max-width: 1099px) { .nav { flex-wrap: wrap !important; overflow: visible; } }' +
    '#userDropdown .menu-item:hover { background: #232734; }';
  document.head.appendChild(style);

  // ========== React to URL changes (back/forward) ==========
  window.addEventListener('popstate', function() {
    var el = document.getElementById('asOfDate');
    var d = window.getGlobalDate();
    if (el && d && el.value !== d) {
      if (el.tagName === 'SELECT') {
        var hasOption = Array.prototype.some.call(el.options, function(o) {
          return o.value === d;
        });
        if (hasOption) el.value = d;
      } else {
        el.value = d;
      }
    }
  });
})();
