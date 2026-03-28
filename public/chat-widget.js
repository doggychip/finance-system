// Floating AI Chat Widget
(function() {
  // Create styles
  var style = document.createElement('style');
  style.textContent = `
    #chat-toggle { position: fixed; bottom: 24px; right: 24px; width: 56px; height: 56px; border-radius: 50%; background: #6366f1; border: none; color: white; font-size: 24px; cursor: pointer; box-shadow: 0 4px 20px rgba(99,102,241,0.4); z-index: 9999; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
    #chat-toggle:hover { transform: scale(1.1); box-shadow: 0 6px 28px rgba(99,102,241,0.6); }
    #chat-panel { position: fixed; bottom: 90px; right: 24px; width: 420px; max-height: 560px; background: #1a1d27; border: 1px solid #2e3344; border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,0.5); z-index: 9998; display: none; flex-direction: column; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
    #chat-panel.open { display: flex; }
    #chat-header { padding: 14px 18px; background: #232734; border-bottom: 1px solid #2e3344; display: flex; justify-content: space-between; align-items: center; }
    #chat-header h3 { font-size: 14px; font-weight: 600; color: #e4e6ef; margin: 0; }
    #chat-header button { background: none; border: none; color: #8b8fa3; cursor: pointer; font-size: 18px; padding: 4px; }
    #chat-messages { flex: 1; overflow-y: auto; padding: 14px 18px; min-height: 300px; max-height: 400px; }
    .chat-msg { margin-bottom: 14px; }
    .chat-msg.user { text-align: right; }
    .chat-msg .bubble { display: inline-block; max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; text-align: left; white-space: pre-wrap; }
    .chat-msg.user .bubble { background: #6366f1; color: white; border-bottom-right-radius: 4px; }
    .chat-msg.ai .bubble { background: #232734; color: #e4e6ef; border: 1px solid #2e3344; border-bottom-left-radius: 4px; }
    .chat-msg.ai .bubble strong { color: #22c55e; }
    .chat-msg .time { font-size: 10px; color: #8b8fa3; margin-top: 4px; }
    #chat-input-wrap { padding: 12px 18px; border-top: 1px solid #2e3344; display: flex; gap: 8px; }
    #chat-input { flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid #2e3344; background: #0f1117; color: #e4e6ef; font-size: 13px; outline: none; }
    #chat-input:focus { border-color: #6366f1; }
    #chat-input::placeholder { color: #8b8fa3; }
    #chat-send { padding: 10px 18px; border-radius: 8px; border: none; background: #6366f1; color: white; font-size: 13px; font-weight: 600; cursor: pointer; }
    #chat-send:hover { opacity: 0.9; }
    #chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
    .typing-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #8b8fa3; margin: 0 2px; animation: bounce 1.4s infinite; }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes bounce { 0%,80%,100% { transform: translateY(0); } 40% { transform: translateY(-8px); } }
  `;
  document.head.appendChild(style);

  // Create toggle button
  var toggle = document.createElement('button');
  toggle.id = 'chat-toggle';
  toggle.innerHTML = '💬';
  toggle.title = 'Ask AI about your finances';
  document.body.appendChild(toggle);

  // Create chat panel
  var panel = document.createElement('div');
  panel.id = 'chat-panel';
  panel.innerHTML = `
    <div id="chat-header">
      <h3>AI Finance Assistant</h3>
      <button onclick="document.getElementById('chat-panel').classList.remove('open')">&times;</button>
    </div>
    <div id="chat-messages">
      <div class="chat-msg ai"><div class="bubble">Hi! I can answer questions about your financial data. Try asking:\n\n• "What's the total cash for each entity?"\n• "Compare LTECH vs OW assets"\n• "Which accounts are overdrawn?"\n• "What are the IC balances?"</div></div>
    </div>
    <div id="chat-input-wrap">
      <input id="chat-input" placeholder="Ask about your finances..." autocomplete="off">
      <button id="chat-send" onclick="sendChat()">Send</button>
    </div>
  `;
  document.body.appendChild(panel);

  // Toggle
  toggle.addEventListener('click', function() {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      document.getElementById('chat-input').focus();
    }
  });

  // Enter key
  document.getElementById('chat-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  window.sendChat = async function() {
    var input = document.getElementById('chat-input');
    var question = input.value.trim();
    if (!question) return;

    var messages = document.getElementById('chat-messages');
    var sendBtn = document.getElementById('chat-send');

    // Add user message
    messages.innerHTML += '<div class="chat-msg user"><div class="bubble">' + escapeHtml(question) + '</div></div>';
    input.value = '';
    sendBtn.disabled = true;

    // Add typing indicator
    messages.innerHTML += '<div class="chat-msg ai" id="typing"><div class="bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div></div>';
    messages.scrollTop = messages.scrollHeight;

    try {
      var res = await fetch('/api/chat/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question }),
      });
      var data = await res.json();

      // Remove typing indicator
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
    // Bold **text**
    text = escapeHtml(text);
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Currency highlighting
    text = text.replace(/\$[\d,]+(\.\d+)?/g, '<strong>$&</strong>');
    return text;
  }
})();
