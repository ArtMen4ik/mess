/**
 * script.js — клиент: Socket.IO → fallback WebSocket
 * Опции:
 *  - индикатор "кто-то печатает"
 *  - показ онлайн-количества участников
 *  - системные сообщения о входе/выходе
 *  - валидация входящих данных
 */

(() => {
  const $ = (sel) => document.querySelector(sel);

  const loginForm     = $('#loginForm');
  const userNameInput = $('#userName');
  const currentUserEl = $('#currentUser');

  const chatWindow    = $('#chatWindow');
  const typingEl      = $('#typingIndicator'); // уже есть в разметке
  const messageForm   = $('#messageForm');
  const messageInput  = $('#messageInput');
  const sendBtn       = $('#sendBtn');

  let userName = '';
  let transport = null; // { kind: 'socketio'|'ws', conn, ready }
  let onlineCount = 0;

  // --- индикатор "печатает" ---
  let typing = false;
  let typingTimer;
  const TYPING_DEBOUNCE = 900; // мс

  const nowTs = () => Date.now();
  const sanitizeText = (str, max = 1000) =>
    String(str ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

  const autoScroll = () => { chatWindow.scrollTop = chatWindow.scrollHeight; };

  const renderSystem = (text) => {
    const el = document.createElement('div');
    el.className = 'system';
    el.textContent = text;
    chatWindow.appendChild(el);
    autoScroll();
  };

  const formatTime = (ts) => {
    const d = new Date(Number(ts) || nowTs());
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const validateIncomingMessage = (msg) => {
    if (typeof msg !== 'object' || msg === null) return null;
    const author = sanitizeText(msg.author, 40);
    const text   = sanitizeText(msg.text, 1000);
    let ts       = Number(msg.ts);
    if (!author || !text) return null;
    if (!Number.isFinite(ts) || ts <= 0) ts = nowTs();
    return { author, text, ts };
  };

  const renderMessage = ({ author, text, ts }) => {
    const isMine = author === userName;

    const wrap = document.createElement('div');
    wrap.className = `message ${isMine ? 'mine' : 'other'}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;

    const meta = document.createElement('div');
    meta.className = 'meta';

    const authorEl = document.createElement('span');
    authorEl.className = 'author';
    authorEl.textContent = author;

    const dot = document.createElement('span'); dot.className = 'dot';

    const timeEl = document.createElement('span');
    timeEl.className = 'time';
    timeEl.textContent = formatTime(ts);

    meta.appendChild(authorEl);
    meta.appendChild(dot);
    meta.appendChild(timeEl);

    wrap.appendChild(bubble);
    wrap.appendChild(meta);

    chatWindow.appendChild(wrap);
    autoScroll();
  };

  const updateHeader = () => {
    if (!userName) {
      currentUserEl.textContent = '';
      return;
    }
    currentUserEl.textContent = `Вы: ${userName} — Онлайн: ${onlineCount}`;
  };

  const Transport = {
    connect(name) {
      userName = name;
      updateHeader();

      // 1) Socket.IO (предпочтительно)
      if (typeof window.io === 'function') {
        const socket = window.io(); // тот же хост/порт
        transport = { kind: 'socketio', conn: socket, ready: false };

        socket.on('connect', () => {
          transport.ready = true;
          socket.emit('join', userName);
        });

        // Входящие сообщения
        socket.on('chat_message', (raw) => {
          const msg = validateIncomingMessage(raw);
          if (msg) renderMessage(msg);
        });

        // Системные уведомления (вход/выход)
        socket.on('system_message', (payload) => {
          if (payload && typeof payload.text === 'string') {
            renderSystem(sanitizeText(payload.text, 200));
          }
        });

        // --- НОВОЕ: индикатор "печатает" от других ---
        socket.on('typing', ({ name, isTyping }) => {
          if (!name || name === userName) return; // себя не показываем
          if (isTyping) {
            typingEl.textContent = `${name} печатает…`;
            typingEl.hidden = false;
          } else {
            typingEl.hidden = true;
          }
        });

        // --- НОВОЕ: счётчик онлайн ---
        socket.on('online_count', ({ count }) => {
          if (Number.isFinite(count)) {
            onlineCount = count;
            updateHeader();
          }
        });

        // Ошибки/разрыв
        socket.on('error_message', (text) => renderSystem(`Ошибка: ${sanitizeText(text, 200)}`));
        socket.on('connect_error', (err) => renderSystem(`Проблема подключения: ${err?.message || err}`));
        socket.on('disconnect', (reason) => {
          transport.ready = false;
          renderSystem(`Отключено: ${reason}`);
        });

        return;
      }

      // 2) Fallback WebSocket (если не подключён socket.io.js и есть сервер /ws)
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${scheme}://${location.host}/ws`;
      const ws = new WebSocket(url);
      transport = { kind: 'ws', conn: ws, ready: false };

      ws.addEventListener('open', () => {
        transport.ready = true;
        ws.send(JSON.stringify({ type: 'join', name: userName }));
      });

      ws.addEventListener('message', (event) => {
        let data; try { data = JSON.parse(event.data); } catch { return; }
        if (data?.type === 'chat') {
          const msg = validateIncomingMessage(data);
          if (msg) renderMessage(msg);
        } else if (data?.type === 'system' && typeof data.text === 'string') {
          renderSystem(sanitizeText(data.text, 200));
        } else if (data?.type === 'online' && Number.isFinite(data.count)) {
          onlineCount = data.count;
          updateHeader();
        } else if (data?.type === 'typing' && data.name !== userName) {
          if (data.isTyping) {
            typingEl.textContent = `${data.name} печатает…`;
            typingEl.hidden = false;
          } else {
            typingEl.hidden = true;
          }
        }
      });

      ws.addEventListener('close', () => {
        transport.ready = false;
        renderSystem('Соединение закрыто');
      });
      ws.addEventListener('error', () => renderSystem('Ошибка WebSocket-соединения'));
    },

    sendMessage(text) {
      const safe = sanitizeText(text);
      if (!safe || !transport?.ready) return;

      if (transport.kind === 'socketio') {
        transport.conn.emit('chat_message', { text: safe });
      } else {
        transport.conn.send(JSON.stringify({ type: 'chat', text: safe }));
      }
    },

    // --- НОВОЕ: отправка статуса "печатает" с дебаунсом ---
    setTyping(state) {
      if (!transport?.ready) return;
      if (transport.kind === 'socketio') {
        transport.conn.emit('typing', !!state);
      } else {
        transport.conn.send(JSON.stringify({ type: 'typing', isTyping: !!state }));
      }
    }
  };

  // ---------- UI: логин ----------
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = sanitizeText(userNameInput.value, 40);
    if (!name) { userNameInput.focus(); return; }
    Transport.connect(name);
    messageInput.disabled = false;
    sendBtn.disabled = false;
    // loginForm.classList.add('hidden'); // по желанию
  });

  // ---------- UI: отправка сообщения ----------
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    Transport.sendMessage(messageInput.value);
    messageInput.value = '';
    // закончили печатать
    if (typing) {
      typing = false;
      Transport.setTyping(false);
      clearTimeout(typingTimer);
    }
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      messageForm.requestSubmit();
    }
  });

  // ---------- НОВОЕ: отправка статуса "печатает" с дебаунсом ----------
  messageInput.addEventListener('input', () => {
    if (!typing) {
      typing = true;
      Transport.setTyping(true);
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      typing = false;
      Transport.setTyping(false);
    }, TYPING_DEBOUNCE);
  });

  // Удобство: Enter на поле имени — это сабмит логина
  userNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      loginForm.requestSubmit();
    }
  });
})();