// Dashboard-wide auth using localStorage
(function() {
  var AUTH_KEY = 'finance_user';

  window.getUser = function() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch(e) { return null; }
  };

  window.setUser = function(user) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  };

  window.logout = function() {
    localStorage.removeItem(AUTH_KEY);
    window.location.href = '/login.html';
  };

  // Check auth on every page except login
  if (!window.location.pathname.includes('login.html')) {
    var user = window.getUser();
    if (!user) {
      window.location.href = '/login.html';
    }
  }

  // Add user info + logout button to header
  window.addUserToHeader = function() {
    var user = window.getUser();
    if (!user) return;
    var header = document.querySelector('.header');
    if (!header) return;

    // Check if already added
    if (document.getElementById('user-info')) return;

    var div = document.createElement('div');
    div.id = 'user-info';
    div.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:8px;';
    div.innerHTML = '<span style="font-size:12px;color:#8b8fa3">' + user.display_name + '</span>' +
      '<button onclick="logout()" style="padding:4px 10px;border-radius:5px;border:1px solid #2e3344;background:#232734;color:#8b8fa3;font-size:11px;cursor:pointer">Logout</button>';
    header.appendChild(div);
  };

  // Auto-add on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.addUserToHeader);
  } else {
    window.addUserToHeader();
  }
})();
