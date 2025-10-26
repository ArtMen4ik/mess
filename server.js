/**
 * server.js — Express + Socket.IO
 * Опциональные фичи:
 *  - индикатор "печатает" (событие typing)
 *  - счётчик подключённых пользователей (только авторизованные по join)
 *  - системные уведомления о входе/выходе
 *  - валидация и обработка ошибок
 */

const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Безопасность и статика ----------
app.use(helmet({ contentSecurityPolicy: false })); // упростим CSP в dev
app.use(express.static(PUBLIC_DIR));
app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ---------- Хранилище, утилиты ----------
/** users: socket.id -> { name } (считаем только вошедших по join) */
const users = new Map();

const log = (...args) => console.log(new Date().toISOString(), '-', ...args);

const sanitize = (str, maxLen = 1000) => {
  if (typeof str !== 'string') return '';
  return str.substring(0, maxLen).replace(/\s+/g, ' ').trim();
};

const validateName = (raw) => {
  const name = sanitize(raw, 40);
  return name || null;
};
const validateText = (raw) => {
  const text = sanitize(raw, 1000);
  return text || null;
};

/** Шлём актуальный онлайн всем (считаем только авторизованных) */
const broadcastOnline = () => {
  io.emit('online_count', { count: users.size });
};

// ---------- Socket.IO события ----------
io.on('connection', (socket) => {
  log(`🔌 connected: ${socket.id}`);

  // Пользователь представляется именем
  socket.on('join', (rawName) => {
    try {
      const name = validateName(rawName);
      if (!name) {
        socket.emit('error_message', 'Некорректное имя пользователя.');
        return;
      }

      // Регистрируем пользователя
      users.set(socket.id, { name });
      log(`👤 joined: ${name} (${socket.id})`);

      // Всем, кроме вошедшего
      socket.broadcast.emit('system_message', {
        type: 'join',
        text: `${name} присоединился(ась) к чату`
      });

      // Текущему — подтверждение
      socket.emit('joined', { name });

      // Обновляем онлайн
      broadcastOnline();
    } catch (err) {
      log('❗ join error:', err?.message || err);
      socket.emit('error_message', 'Ошибка при входе в чат.');
    }
  });

  // Получение текстового сообщения
  socket.on('chat_message', (payload) => {
    try {
      const user = users.get(socket.id);
      if (!user) {
        socket.emit('error_message', 'Сначала введите имя пользователя.');
        return;
      }

      const text = validateText(payload?.text);
      if (!text) return; // пустые игнорируем

      const message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        author: user.name,
        text,
        ts: Date.now()
      };

      log(`✉️  ${user.name}: ${text}`);

      // Broadcast всем (включая отправителя)
      io.emit('chat_message', message);
    } catch (err) {
      log('❗ chat_message error:', err?.message || err);
      socket.emit('error_message', 'Произошла ошибка при отправке сообщения.');
    }
  });

  // Индикатор "пользователь печатает"
  socket.on('typing', (isTyping) => {
    const user = users.get(socket.id);
    if (!user) return;
    // Просто транслируем всем: кто печатает и его состояние
    io.emit('typing', { name: user.name, isTyping: !!isTyping, id: socket.id });
  });

  // Отключение
  socket.on('disconnect', (reason) => {
    const user = users.get(socket.id);
    users.delete(socket.id);

    if (user?.name) {
      log(`🔌 disconnected: ${user.name} (${socket.id}) reason=${reason}`);
      // Сообщаем всем, что пользователь вышел
      socket.broadcast.emit('system_message', {
        type: 'leave',
        text: `${user.name} вышел(ла) из чата`
      });
      // Обновляем онлайн
      broadcastOnline();
    } else {
      log(`🔌 disconnected (unauth): ${socket.id} reason=${reason}`);
    }
  });

  // Ошибка сокета
  socket.on('error', (err) => {
    log('❗ socket error:', err?.message || err);
  });
});

// ---------- Старт ----------

server.listen(PORT, '0.0.0.0', () => {
  log(`🚀 server listening on http://0.0.0.0:${PORT}`);
  log(`📁 static served from: ${PUBLIC_DIR}`);
});
