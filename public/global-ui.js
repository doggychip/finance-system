// Global UI state: shared date picker, user menu, i18n
// Include after auth.js, before page-specific scripts

(function() {
  // ========== i18n ==========
  var TRANSLATIONS = {
    en: {
      'nav.overview': 'Overview', 'nav.reports': 'Reports', 'nav.cash': 'Cash',
      'nav.consolidated': 'Consolidated', 'nav.ic_detail': 'IC Detail',
      'nav.reconciliation': 'Reconciliation', 'nav.tasks': 'Tasks',
      'menu.change_password': 'Change Password', 'menu.admin': 'Admin',
      'menu.logout': 'Logout', 'menu.language': 'Language',
      'date.today': 'Today', 'date.month_end': 'Month End',
      'date.last_month': 'Last Month', 'date.quarter_end': 'Quarter End',
      'date.ytd': 'YTD', 'date.as_of': 'As of',
      'tooltip.consolidated': 'Combined balance sheet across all entities',
      'tooltip.ic_detail': 'Intercompany transactions between entities',
      'tooltip.reconciliation': 'Compare Odoo records vs ledger',
    },
    zh: {
      'nav.overview': '总览', 'nav.reports': '报表', 'nav.cash': '现金',
      'nav.consolidated': '合并报表', 'nav.ic_detail': '内部往来',
      'nav.reconciliation': '核对', 'nav.tasks': '任务',
      'menu.change_password': '修改密码', 'menu.admin': '管理',
      'menu.logout': '登出', 'menu.language': '语言',
      'date.today': '今天', 'date.month_end': '月末',
      'date.last_month': '上月', 'date.quarter_end': '季末',
      'date.ytd': '今年', 'date.as_of': '截至',
      'tooltip.consolidated': '所有实体的合并资产负债表',
      'tooltip.ic_detail': '实体间往来交易',
      'tooltip.reconciliation': 'Odoo记录与账本对比',
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

  // ========== Global Date State ==========
  var DATE_KEY = 'finance_as_of_date';

  window.getGlobalDate = function() {
    // URL param takes precedence
    var urlParams = new URLSearchParams(window.location.search);
    var urlDate = urlParams.get('as_of_date');
    if (urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate)) return urlDate;
    // Then localStorage
    return localStorage.getItem(DATE_KEY) || '2026-02-28';
  };

  window.setGlobalDate = function(date, reload) {
    localStorage.setItem(DATE_KEY, date);
    // Update URL
    var url = new URL(window.location);
    url.searchParams.set('as_of_date', date);
    window.history.replaceState({}, '', url);
    if (reload !== false) {
      window.dispatchEvent(new CustomEvent('finance:date-change', { detail: { date: date } }));
    }
  };

  // Date quick-selects
  window.getDateShortcut = function(type) {
    var d = new Date();
    switch (type) {
      case 'today':
        return d.toISOString().slice(0, 10);
      case 'month_end':
        return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
      case 'last_month':
        return new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10);
      case 'quarter_end':
        var q = Math.floor(d.getMonth() / 3);
        return new Date(d.getFullYear(), (q + 1) * 3, 0).toISOString().slice(0, 10);
      case 'ytd':
        return d.toISOString().slice(0, 10);
    }
    return d.toISOString().slice(0, 10);
  };

  // ========== Global Header (nav + actions) ==========
  window.renderGlobalHeader = function(activePage) {
    var header = document.querySelector('.header');
    if (!header) return;

    var user = window.getUser && window.getUser();
    var lang = window.getLang();

    // Build nav with tooltips
    var navItems = [
      { id: 'overview', href: '/', label: window.t('nav.overview'), tooltip: '' },
      { id: 'reports', href: '/reports.html', label: window.t('nav.reports'), tooltip: '' },
      { id: 'cash', href: '/cash.html', label: window.t('nav.cash'), tooltip: '' },
      { id: 'consolidated', href: '/consolidated-bs.html', label: window.t('nav.consolidated'), tooltip: window.t('tooltip.consolidated') },
      { id: 'ic_detail', href: '/ic-detail.html', label: window.t('nav.ic_detail'), tooltip: window.t('tooltip.ic_detail') },
      { id: 'reconciliation', href: '/reconciliation.html', label: window.t('nav.reconciliation'), tooltip: window.t('tooltip.reconciliation') },
      { id: 'tasks', href: '/kanban.html', label: window.t('nav.tasks'), tooltip: '' },
    ];

    // Clear existing nav and actions
    var existingNav = header.querySelector('.nav');
    var existingActions = header.querySelector('.actions');
    if (existingNav) existingNav.remove();
    if (existingActions) existingActions.remove();
    var existingUserInfo = document.getElementById('user-info');
    if (existingUserInfo) existingUserInfo.remove();
    var existingMenu = document.getElementById('user-menu');
    if (existingMenu) existingMenu.remove();

    // Build nav
    var nav = document.createElement('div');
    nav.className = 'nav';
    nav.innerHTML = navItems.map(function(n) {
      var cls = n.id === activePage ? 'active' : '';
      var title = n.tooltip ? ' title="' + n.tooltip + '"' : '';
      return '<a href="' + n.href + '" class="' + cls + '"' + title + '>' + n.label + '</a>';
    }).join('');
    header.appendChild(nav);

    // Build actions with date picker + user menu
    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;align-items:center;gap:8px;';
    actions.innerHTML =
      '<div class="global-date-control" style="display:flex;align-items:center;gap:4px;padding:4px;background:var(--surface2,#232734);border:1px solid var(--border,#2e3344);border-radius:6px;">' +
        '<label style="font-size:11px;color:var(--text-dim,#8b8fa3);padding:0 6px">' + window.t('date.as_of') + '</label>' +
        '<input type="date" id="globalDate" value="' + window.getGlobalDate() + '" style="padding:4px 6px;border-radius:4px;border:1px solid var(--border,#2e3344);background:var(--surface,#1a1d27);color:var(--text,#e4e6ef);font-size:11px;">' +
        '<button class="btn" onclick="applyGlobalDate()" style="padding:4px 10px;font-size:11px">Apply</button>' +
      '</div>' +
      '<div class="date-chips" style="display:flex;gap:4px;">' +
        '<button class="chip-btn" onclick="setDateShortcut(\'today\')" title="' + window.t('date.today') + '" style="padding:4px 8px;background:var(--surface2,#232734);border:1px solid var(--border,#2e3344);border-radius:4px;color:var(--text-secondary,#b0b8c4);font-size:10px;cursor:pointer">' + window.t('date.today') + '</button>' +
        '<button class="chip-btn" onclick="setDateShortcut(\'month_end\')" title="' + window.t('date.month_end') + '" style="padding:4px 8px;background:var(--surface2,#232734);border:1px solid var(--border,#2e3344);border-radius:4px;color:var(--text-secondary,#b0b8c4);font-size:10px;cursor:pointer">' + window.t('date.month_end') + '</button>' +
      '</div>';

    // User menu (collapsed dropdown)
    if (user) {
      actions.innerHTML += '<div id="user-menu" style="position:relative">' +
        '<button id="userBtn" onclick="toggleUserMenu()" style="display:flex;align-items:center;gap:6px;padding:5px 10px;background:var(--surface2,#232734);border:1px solid var(--border,#2e3344);border-radius:20px;color:var(--text,#e4e6ef);font-size:12px;cursor:pointer">' +
          '<span style="width:22px;height:22px;border-radius:50%;background:var(--accent,#6366f1);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px">' + (user.display_name || 'U').charAt(0) + '</span>' +
          '<span style="max-width:120px;overflow:hidden;text-overflow:ellipsis">' + (user.display_name || user.username) + '</span>' +
          '<span style="color:var(--text-dim,#8b8fa3)">▾</span>' +
        '</button>' +
        '<div id="userDropdown" style="display:none;position:absolute;top:100%;right:0;margin-top:4px;background:var(--surface,#1a1d27);border:1px solid var(--border,#2e3344);border-radius:8px;min-width:180px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:100;overflow:hidden">' +
          (user.role === 'admin' ? '<a href="/admin.html" class="menu-item" style="display:block;padding:10px 14px;color:var(--text,#e4e6ef);text-decoration:none;font-size:12px;border-bottom:1px solid var(--border,#2e3344)">⚙ ' + window.t('menu.admin') + '</a>' : '') +
          '<button onclick="openPasswordModal();toggleUserMenu()" class="menu-item" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;color:var(--text,#e4e6ef);font-size:12px;cursor:pointer;border-bottom:1px solid var(--border,#2e3344)">🔒 ' + window.t('menu.change_password') + '</button>' +
          '<div class="menu-item" style="padding:10px 14px;font-size:12px;border-bottom:1px solid var(--border,#2e3344);color:var(--text-dim,#8b8fa3)">' + window.t('menu.language') + ': ' +
            '<button onclick="setLang(\'en\')" style="padding:2px 8px;margin-left:4px;background:' + (lang === 'en' ? 'var(--accent,#6366f1)' : 'transparent') + ';color:' + (lang === 'en' ? 'white' : 'var(--text,#e4e6ef)') + ';border:1px solid var(--border,#2e3344);border-radius:4px;font-size:11px;cursor:pointer">EN</button> ' +
            '<button onclick="setLang(\'zh\')" style="padding:2px 8px;background:' + (lang === 'zh' ? 'var(--accent,#6366f1)' : 'transparent') + ';color:' + (lang === 'zh' ? 'white' : 'var(--text,#e4e6ef)') + ';border:1px solid var(--border,#2e3344);border-radius:4px;font-size:11px;cursor:pointer">中文</button>' +
          '</div>' +
          '<button onclick="logout()" class="menu-item" style="display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;color:var(--negative,#ef4444);font-size:12px;cursor:pointer">→ ' + window.t('menu.logout') + '</button>' +
        '</div>' +
      '</div>';
    }

    actions.className = 'actions-wrapper';
    header.appendChild(actions);

    // Close dropdown on outside click
    document.addEventListener('click', function(e) {
      var dropdown = document.getElementById('userDropdown');
      var btn = document.getElementById('userBtn');
      if (dropdown && btn && !btn.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  };

  window.toggleUserMenu = function() {
    var d = document.getElementById('userDropdown');
    if (d) d.style.display = d.style.display === 'none' ? 'block' : 'none';
  };

  window.applyGlobalDate = function() {
    var input = document.getElementById('globalDate');
    if (input && input.value) {
      window.setGlobalDate(input.value);
      location.reload();
    }
  };

  window.setDateShortcut = function(type) {
    var date = window.getDateShortcut(type);
    window.setGlobalDate(date);
    location.reload();
  };

  // Auto-wrap nav links with nowrap on wider screens
  var style = document.createElement('style');
  style.textContent = `
    .header { flex-wrap: nowrap !important; gap: 12px; }
    .nav { flex-wrap: nowrap !important; overflow-x: auto; }
    .nav a { white-space: nowrap; }
    @media (max-width: 1199px) { .nav { flex-wrap: wrap !important; } }
    .actions-wrapper { flex-shrink: 0; }
    #userDropdown .menu-item:hover { background: var(--surface2, #232734); }
    .chip-btn:hover { background: var(--border, #2e3344) !important; color: var(--text, #e4e6ef) !important; }
  `;
  document.head.appendChild(style);
})();
