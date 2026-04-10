// AI Chat Sidebar Widget
(function() {
  var style = document.createElement('style');
  style.textContent = `
    #chat-toggle { position: fixed; top: 50%; right: 0; transform: translateY(-50%); width: 32px; height: 80px; border-radius: 8px 0 0 8px; background: #6366f1; border: none; color: white; font-size: 16px; cursor: pointer; z-index: 9998; display: flex; align-items: center; justify-content: center; writing-mode: vertical-rl; font-weight: 600; font-size: 11px; letter-spacing: 1px; box-shadow: -2px 0 10px rgba(99,102,241,0.3); }
    #chat-toggle:hover { width: 36px; background: #5558e6; }
    #chat-toggle.open { display: none; }
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

  // Toggle tab
  var toggle = document.createElement('button');
  toggle.id = 'chat-toggle';
  toggle.textContent = 'AI';
  toggle.title = 'Ask AI about your finances';
  document.body.appendChild(toggle);

  // Sidebar
  var sidebar = document.createElement('div');
  sidebar.id = 'chat-sidebar';
  sidebar.innerHTML = `
    <div id="chat-sidebar-header">
      <h3>AI Finance Assistant</h3>
      <button onclick="toggleChat()">&times;</button>
    </div>
    <div id="chat-messages">
      <div class="chat-msg ai"><div class="bubble">Hi! I can answer questions about your financial data. Try asking:\n\n• "What's the total cash for each entity?"\n• "Compare LTECH vs OW assets"\n• "Which accounts are overdrawn?"\n• "What are the IC balances?"\n• "What's our runway?"</div></div>
    </div>
    <div id="chat-input-wrap">
      <input id="chat-input" placeholder="Ask about your finances..." autocomplete="off">
      <button id="chat-send" onclick="sendChat()">Send</button>
    </div>
  `;
  document.body.appendChild(sidebar);

  window.toggleChat = function() {
    sidebar.classList.toggle('open');
    toggle.classList.toggle('open');
    if (sidebar.classList.contains('open')) {
      document.getElementById('chat-input').focus();
    }
  };

  toggle.addEventListener('click', window.toggleChat);

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
