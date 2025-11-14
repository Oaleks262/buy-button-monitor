const socket = io();

// DOM Elements
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const openBrowserBtn = document.getElementById('openBrowserBtn');
const saveSessionBtn = document.getElementById('saveSessionBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const logsContainer = document.getElementById('logs');
const botTokenInput = document.getElementById('botToken');
const chatIdInput = document.getElementById('chatId');
const intervalInput = document.getElementById('interval');
const getChatIdLink = document.getElementById('getChatIdLink');
const modal = document.getElementById('chatIdModal');
const closeModal = document.querySelector('.close');
const vncContainer = document.getElementById('vncContainer');
const vncFrame = document.getElementById('vncFrame');
const fullscreenVnc = document.getElementById('fullscreenVnc');
const closeVnc = document.getElementById('closeVnc');

// Завантажити збережені дані з localStorage
const savedBotToken = localStorage.getItem('botToken');
const savedChatId = localStorage.getItem('chatId');
const savedInterval = localStorage.getItem('interval');

if (savedBotToken) botTokenInput.value = savedBotToken;
if (savedChatId) chatIdInput.value = savedChatId;
if (savedInterval) intervalInput.value = savedInterval;

// Отримання логів від сервера через WebSocket
socket.on('log', (data) => {
  addLog(data.message, data.type);
});

socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  addLog('❌ З\'єднання з сервером втрачено', 'error');
});

// Функція додавання логу
function addLog(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  
  const time = new Date().toLocaleTimeString('uk-UA');
  entry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;
  
  logsContainer.appendChild(entry);
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

// Функція встановлення статусу
function setStatus(status, text) {
  const dot = statusIndicator.querySelector('.dot');
  dot.className = `dot ${status}`;
  statusText.textContent = text;
}

// Функція блокування/розблокування кнопок
function setButtonsState(state) {
  switch(state) {
    case 'initial':
      openBrowserBtn.disabled = false;
      saveSessionBtn.disabled = true;
      startBtn.disabled = true;
      stopBtn.disabled = true;
      break;
    case 'browser-open':
      openBrowserBtn.disabled = true;
      saveSessionBtn.disabled = false;
      startBtn.disabled = true;
      stopBtn.disabled = true;
      break;
    case 'session-saved':
      openBrowserBtn.disabled = false;
      saveSessionBtn.disabled = true;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      break;
    case 'monitoring':
      openBrowserBtn.disabled = true;
      saveSessionBtn.disabled = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      break;
  }
}

// КНОПКА: Відкрити браузер з VNC
openBrowserBtn.addEventListener('click', async () => {
  openBrowserBtn.disabled = true;
  openBrowserBtn.innerHTML = '⏳ Запускаю...';
  addLog('Запускаю браузер з VNC...', 'info');
  
  try {
    const response = await fetch('/api/open-browser', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Показуємо VNC viewer
      addLog('⏳ Завантаження VNC інтерфейсу (може зайняти 5-10 секунд)...', 'info');
      
      setTimeout(() => {
        vncContainer.style.display = 'block';
        vncFrame.src = `/vnc/vnc.html?host=${window.location.hostname}&port=6080&autoconnect=true&resize=scale`;
        
        setStatus('active', 'Браузер відкрито у VNC');
        saveSessionBtn.disabled = false;
        openBrowserBtn.innerHTML = '🖥️ Відкрити браузер з VNC';
        
        addLog('✅ VNC підключено! Тепер авторизуйтесь у вікні вище ↑', 'success');
      }, 3000);
      
      setButtonsState('browser-open');
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    addLog(`Помилка: ${error.message}`, 'error');
    openBrowserBtn.disabled = false;
    openBrowserBtn.innerHTML = '🖥️ Відкрити браузер з VNC';
  }
});

// КНОПКА: Зберегти сесію
saveSessionBtn.addEventListener('click', async () => {
  saveSessionBtn.disabled = true;
  saveSessionBtn.innerHTML = '⏳ Зберігаю...';
  addLog('Зберігаю сесію...', 'info');
  
  try {
    const response = await fetch('/api/save-session', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    if (data.success) {
      setStatus('', 'Готово до моніторингу');
      setButtonsState('session-saved');
      saveSessionBtn.innerHTML = '💾 Зберегти сесію';
      
      // Закриваємо VNC
      vncContainer.style.display = 'none';
      vncFrame.src = '';
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    addLog(`Помилка: ${error.message}`, 'error');
    saveSessionBtn.disabled = false;
    saveSessionBtn.innerHTML = '💾 Зберегти сесію';
  }
});

// КНОПКА: Запустити моніторинг
startBtn.addEventListener('click', async () => {
  const botToken = botTokenInput.value.trim();
  const chatId = chatIdInput.value.trim();
  const interval = parseInt(intervalInput.value);
  
  if (!botToken) {
    addLog('❌ Вкажіть Telegram Bot Token!', 'error');
    botTokenInput.focus();
    return;
  }
  
  if (!chatId) {
    addLog('❌ Вкажіть Telegram Chat ID!', 'error');
    chatIdInput.focus();
    return;
  }
  
  if (interval < 10) {
    addLog('❌ Мінімальний інтервал - 10 секунд!', 'error');
    intervalInput.focus();
    return;
  }
  
  // Зберегти в localStorage
  localStorage.setItem('botToken', botToken);
  localStorage.setItem('chatId', chatId);
  localStorage.setItem('interval', interval);
  
  startBtn.disabled = true;
  startBtn.innerHTML = '⏳ Запускаю...';
  addLog('Запускаю моніторинг...', 'info');
  
  try {
    const response = await fetch('/api/start-monitoring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botToken, chatId, interval })
    });
    
    const data = await response.json();
    
    if (data.success) {
      setStatus('monitoring', 'Моніторинг активний');
      setButtonsState('monitoring');
      startBtn.innerHTML = '▶️ Запустити моніторинг';
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    addLog(`Помилка: ${error.message}`, 'error');
    startBtn.disabled = false;
    startBtn.innerHTML = '▶️ Запустити моніторинг';
  }
});

// КНОПКА: Зупинити моніторинг
stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  stopBtn.innerHTML = '⏳ Зупиняю...';
  addLog('Зупиняю моніторинг...', 'info');
  
  try {
    const response = await fetch('/api/stop-monitoring', { 
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    if (data.success) {
      setStatus('', 'Зупинено');
      setButtonsState('session-saved');
      stopBtn.innerHTML = '⏹️ Зупинити моніторинг';
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    addLog(`Помилка: ${error.message}`, 'error');
    stopBtn.disabled = false;
    stopBtn.innerHTML = '⏹️ Зупинити моніторинг';
  }
});

// КНОПКА: Очистити логи
clearLogsBtn.addEventListener('click', () => {
  logsContainer.innerHTML = '';
  addLog('Логи очищено', 'info');
});

// Повний екран VNC
fullscreenVnc.addEventListener('click', () => {
  if (vncFrame.requestFullscreen) {
    vncFrame.requestFullscreen();
  } else if (vncFrame.webkitRequestFullscreen) {
    vncFrame.webkitRequestFullscreen();
  } else if (vncFrame.mozRequestFullScreen) {
    vncFrame.mozRequestFullScreen();
  }
});

// Закрити VNC
closeVnc.addEventListener('click', () => {
  vncContainer.style.display = 'none';
  vncFrame.src = '';
  addLog('VNC закрито', 'info');
});

// МОДАЛЬНЕ ВІКНО: Як отримати Chat ID
getChatIdLink.addEventListener('click', (e) => {
  e.preventDefault();
  modal.style.display = 'block';
});

closeModal.addEventListener('click', () => {
  modal.style.display = 'none';
});

window.addEventListener('click', (e) => {
  if (e.target === modal) {
    modal.style.display = 'none';
  }
});

// Перевірка статусу при завантаженні сторінки
async function checkInitialStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    
    if (data.hasSession) {
      addLog('✅ Знайдено збережену сесію', 'success');
      setButtonsState('session-saved');
    } else {
      addLog('ℹ️ Спочатку потрібно авторизуватись', 'info');
      setButtonsState('initial');
    }
    
    if (data.monitoring) {
      setStatus('monitoring', 'Моніторинг активний');
      setButtonsState('monitoring');
      addLog('✅ Моніторинг вже запущено', 'success');
    }
  } catch (error) {
    console.error('Error checking status:', error);
    addLog('⚠️ Не вдалося перевірити статус', 'warning');
  }
}

// Запуск перевірки при завантаженні
checkInitialStatus();

// Показати версію та інфо
console.log('%c Buy Button Monitor v1.0 with VNC ', 'background: #667eea; color: white; font-size: 16px; padding: 5px 10px; border-radius: 5px;');
console.log('Server connected ✅');