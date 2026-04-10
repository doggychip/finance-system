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
    var adminLink = user.role === 'admin' ? '<a href="/admin.html" style="padding:4px 10px;border-radius:5px;border:1px solid #2e3344;background:#232734;color:#8b8fa3;font-size:11px;cursor:pointer;text-decoration:none">Admin</a>' : '';
    div.innerHTML = '<span style="font-size:12px;color:#8b8fa3">' + user.display_name + '</span>' +
      '<button onclick="openPasswordModal()" style="padding:4px 10px;border-radius:5px;border:1px solid #2e3344;background:#232734;color:#8b8fa3;font-size:11px;cursor:pointer">Change Password</button>' +
      adminLink +
      '<button onclick="logout()" style="padding:4px 10px;border-radius:5px;border:1px solid #2e3344;background:#232734;color:#8b8fa3;font-size:11px;cursor:pointer">Logout</button>';
    header.appendChild(div);

    // Inject password change modal
    if (!document.getElementById('pwModalOverlay')) {
      var modal = document.createElement('div');
      modal.id = 'pwModalOverlay';
      modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:200;align-items:center;justify-content:center;';
      modal.innerHTML =
        '<div style="background:#1a1d27;border:1px solid #2e3344;border-radius:12px;padding:24px;width:400px;max-width:90vw">' +
          '<h2 style="font-size:16px;margin-bottom:16px;color:#e4e6ef">Change Password</h2>' +
          '<div id="pwMsg" style="display:none;padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:12px"></div>' +
          '<label style="display:block;font-size:12px;color:#8b8fa3;margin-bottom:4px">Current Password</label>' +
          '<input type="password" id="pwCurrent" style="width:100%;padding:8px 12px;background:#232734;border:1px solid #2e3344;border-radius:6px;color:#e4e6ef;font-size:13px;margin-bottom:12px">' +
          '<label style="display:block;font-size:12px;color:#8b8fa3;margin-bottom:4px">New Password</label>' +
          '<input type="password" id="pwNew" style="width:100%;padding:8px 12px;background:#232734;border:1px solid #2e3344;border-radius:6px;color:#e4e6ef;font-size:13px;margin-bottom:12px">' +
          '<label style="display:block;font-size:12px;color:#8b8fa3;margin-bottom:4px">Confirm New Password</label>' +
          '<input type="password" id="pwConfirm" style="width:100%;padding:8px 12px;background:#232734;border:1px solid #2e3344;border-radius:6px;color:#e4e6ef;font-size:13px;margin-bottom:16px">' +
          '<div style="display:flex;justify-content:flex-end;gap:8px">' +
            '<button onclick="closePasswordModal()" style="padding:8px 16px;border-radius:6px;border:1px solid #2e3344;background:#232734;color:#e4e6ef;font-size:13px;cursor:pointer">Cancel</button>' +
            '<button onclick="submitPasswordChange()" style="padding:8px 16px;border-radius:6px;border:1px solid #6366f1;background:#6366f1;color:white;font-size:13px;cursor:pointer">Save</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(modal);
    }
  };

  window.openPasswordModal = function() {
    var m = document.getElementById('pwModalOverlay');
    if (m) {
      m.style.display = 'flex';
      document.getElementById('pwCurrent').value = '';
      document.getElementById('pwNew').value = '';
      document.getElementById('pwConfirm').value = '';
      var msg = document.getElementById('pwMsg');
      msg.style.display = 'none';
      document.getElementById('pwCurrent').focus();
    }
  };

  window.closePasswordModal = function() {
    var m = document.getElementById('pwModalOverlay');
    if (m) m.style.display = 'none';
  };

  window.submitPasswordChange = async function() {
    var msg = document.getElementById('pwMsg');
    var current = document.getElementById('pwCurrent').value;
    var newPw = document.getElementById('pwNew').value;
    var confirm = document.getElementById('pwConfirm').value;

    if (!current) {
      msg.style.display = 'block';
      msg.style.background = 'rgba(239,68,68,0.15)';
      msg.style.color = '#ef4444';
      msg.textContent = 'Please enter your current password';
      return;
    }
    if (!newPw || newPw.length < 4) {
      msg.style.display = 'block';
      msg.style.background = 'rgba(239,68,68,0.15)';
      msg.style.color = '#ef4444';
      msg.textContent = 'New password must be at least 4 characters';
      return;
    }
    if (newPw !== confirm) {
      msg.style.display = 'block';
      msg.style.background = 'rgba(239,68,68,0.15)';
      msg.style.color = '#ef4444';
      msg.textContent = 'New passwords do not match';
      return;
    }

    var user = window.getUser();
    try {
      var res = await fetch('/api/tasks/users/' + user.id + '/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: newPw })
      });
      var data = await res.json();
      if (!res.ok) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(239,68,68,0.15)';
        msg.style.color = '#ef4444';
        msg.textContent = data.error || 'Failed to change password';
        return;
      }
      msg.style.display = 'block';
      msg.style.background = 'rgba(34,197,94,0.15)';
      msg.style.color = '#22c55e';
      msg.textContent = 'Password changed successfully!';
      setTimeout(function() { window.closePasswordModal(); }, 1500);
    } catch (e) {
      msg.style.display = 'block';
      msg.style.background = 'rgba(239,68,68,0.15)';
      msg.style.color = '#ef4444';
      msg.textContent = 'Network error';
    }
  };

  // Auto-add on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.addUserToHeader);
  } else {
    window.addUserToHeader();
  }
})();
