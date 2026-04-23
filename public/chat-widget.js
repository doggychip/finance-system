// AI Chat Sidebar Widget
(function() {
  var style = document.createElement('style');
  style.textContent = `
    /* 9.1 Floating action button (circular, bottom-right) */
    #chat-toggle {
      position: fixed; bottom: 20px; right: 20px;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border: none; color: white; font-size: 22px;
      cursor: pointer; z-index: 9998;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 16px rgba(99,102,241,0.4);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    #chat-toggle:hover { transform: scale(1.08); box-shadow: 0 6px 20px rgba(99,102,241,0.6); }
    #chat-toggle.open { opacity: 0; pointer-events: none; transform: scale(0.8); }
    /* 9.3 Welcome prompt chips */
    .chat-prompt-chip {
      display: block; width: 100%; text-align: left;
      padding: 10px 14px; margin-bottom: 6px;
      background: #232734; border: 1px solid #2e3344; border-radius: 10px;
      color: #b0b8c4; font-size: 12px; cursor: pointer;
      transition: all 0.15s ease;
    }
    .chat-prompt-chip:hover { background: #2e3344; color: #f0f2f8; border-color: #6366f1; }
    /* 9.4 Keyboard shortcut hint */
    .kbd-hint { display:inline-block; padding: 1px 5px; background: #2e3344; border-radius: 3px; font-size: 10px; color: #b0b8c4; font-family: monospace; margin-left: 4px; }
    #chat-sidebar { position: fixed; top: 0; right: -400px; width: 400px; height: 100vh; background: #1a1d27; border-left: 1px solid #2e3344; z-index: 9999; display: flex; flex-direction: column; transition: right 0.3s ease; box-shadow: -4px 0 20px rgba(0,0,0,0.4); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
    #chat-sidebar.open { right: 0; }
    #chat-sidebar-header { padding: 16px 20px; background: #232734; border-bottom: 1px solid #2e3344; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
    #chat-sidebar-header h3 { font-size: 15px; font-weight: 600; color: #e4e6ef; margin: 0; }
    #chat-sidebar-header button { background: none; border: 1px solid #2e3344; border-radius: 6px; color: #8b8fa3; cursor: pointer; font-size: 18px; padding: 4px 10px; }
    #chat-sidebar-header button:hover { background: #2e3344; color: #e4e6ef; }
    #chat-messages { flex: 1; overflow-y: auto; padding: 16px 20px; }
    .chat-msg { margin-bottom: 16px; }
    .chat-msg.user { text-align: right; }
    .chat-msg .bubble { display: inline-block; max-width: 90%; padding: 12px 16px; border-radius: 12px; font-size: 13px; line-height: 1.6; text-align: left; white-space: pre-wrap; word-wrap: break-word; }
    .chat-msg.user .bubble { background: #6366f1; color: white; border-bottom-right-radius: 4px; }
    .chat-msg.ai .bubble { background: #232734; color: #e4e6ef; border: 1px solid #2e3344; border-bottom-left-radius: 4px; }
    .chat-msg.ai .bubble strong { color: #22c55e; }
    .chat-msg .time { font-size: 10px; color: #8b8fa3; margin-top: 4px; }
    #chat-input-wrap { padding: 14px 20px; border-top: 1px solid #2e3344; display: flex; gap: 8px; flex-shrink: 0; background: #1a1d27; }
    #chat-input { flex: 1; padding: 12px 14px; border-radius: 8px; border: 1px solid #2e3344; background: #0f1117; color: #e4e6ef; font-size: 13px; outline: none; }
    #chat-input:focus { border-color: #6366f1; }
    #chat-input::placeholder { color: #8b8fa3; }
    #chat-send { padding: 12px 20px; border-radius: 8px; border: none; background: #6366f1; color: white; font-size: 13px; font-weight: 600; cursor: pointer; }
    #chat-send:hover { opacity: 0.9; }
    #chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
    .typing-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #8b8fa3; margin: 0 2px; animation: bounce 1.4s infinite; }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce { 0%,80%,100% { transform: translateY(0); } 40% { transform: translateY(-8px); } }
  `;
  document.head.appendChild(style);

  // 9.1 Circular FAB toggle (bottom-right with sparkle icon)
  var toggle = document.createElement('button');
  toggle.id = 'chat-toggle';
  toggle.innerHTML = '✨';
  toggle.title = 'Ask AI about your finances (press / to open)';
  document.body.appendChild(toggle);

  // 9.2 Slide-out panel (right side, 400px)
  var sidebar = document.createElement('div');
  sidebar.id = 'chat-sidebar';
  sidebar.innerHTML = `
    <div id="chat-sidebar-header">
      <h3>✨ AI Finance Assistant</h3>
      <button onclick="toggleChat()" title="Close (Esc)">&times;</button>
    </div>
    <div id="chat-messages">
      <div class="chat-msg ai"><div class="bubble">Hi! Ask me anything about your financial data, or try one of these:</div></div>
      <div id="chat-prompts" style="padding: 4px 0 8px;">
        <button class="chat-prompt-chip" onclick="chatPrompt(this.textContent)">What's my current cash position?</button>
        <button class="chat-prompt-chip" onclick="chatPrompt(this.textContent)">Show overdue tasks</button>
        <button class="chat-prompt-chip" onclick="chatPrompt(this.textContent)">Summarize this month's cash flow</button>
        <button class="chat-prompt-chip" onclick="chatPrompt(this.textContent)">Which entities are overdrawn?</button>
      </div>
    </div>
    <div id="chat-input-wrap">
      <input id="chat-input" placeholder="Ask about your finances..." autocomplete="off">
      <button id="chat-send" onclick="sendChat()">Send</button>
    </div>
  `;
  document.body.appendChild(sidebar);

  // 9.4 Welcome prompt helper + keyboard shortcut
  window.chatPrompt = function(text) {
    document.getElementById('chat-input').value = text;
    sendChat();
  };

  window.toggleChat = function() {
    sidebar.classList.toggle('open');
    toggle.classList.toggle('open');
    if (sidebar.classList.contains('open')) {
      document.getElementById('chat-input').focus();
    }
  };

  toggle.addEventListener('click', window.toggleChat);

  // 9.4 Keyboard shortcut: / opens chat (if not in an input)
  document.addEventListener('keydown', function(e) {
    var tag = (e.target && e.target.tagName || '').toLowerCase();
    var isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable);
    if (e.key === '/' && !isTyping && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (!sidebar.classList.contains('open')) window.toggleChat();
      else document.getElementById('chat-input').focus();
    } else if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      window.toggleChat();
    }
  });

  document.getElementById('chat-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  window.sendChat = async function() {
    var input = document.getElementById('chat-input');
    var question = input.value.trim();
    if (!question) return;

    var messages = document.getElementById('chat-messages');
    var sendBtn = document.getElementById('chat-send');

    messages.innerHTML += '<div class="chat-msg user"><div class="bubble">' + escapeHtml(question) + '</div></div>';
    input.value = '';
    sendBtn.disabled = true;

    messages.innerHTML += '<div class="chat-msg ai" id="typing"><div class="bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div></div>';
    messages.scrollTop = messages.scrollHeight;

    try {
      var res = await fetch('/api/chat/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question }),
      });
      var data = await res.json();

      var typing = document.getElementById('typing');
      if (typing) typing.remove();

      if (data.error) {
        messages.innerHTML += '<div class="chat-msg ai"><div class="bubble" style="color:#ef4444">Error: ' + escapeHtml(data.error) + '</div></div>';
      } else {
        messages.innerHTML += '<div class="chat-msg ai"><div class="bubble">' + formatAnswer(data.answer) + '</div><div class="time">Data as of ' + (data.snapshot_date || 'latest') + '</div></div>';
      }
    } catch (err) {
      var typing = document.getElementById('typing');
      if (typing) typing.remove();
      messages.innerHTML += '<div class="chat-msg ai"><div class="bubble" style="color:#ef4444">Connection error. Please try again.</div></div>';
    }

    sendBtn.disabled = false;
    messages.scrollTop = messages.scrollHeight;
    input.focus();
  };

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatAnswer(text) {
    text = escapeHtml(text);
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\$[\d,]+(\.\d+)?/g, '<strong>$&</strong>');
    return text;
  }
})();
