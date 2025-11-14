const socket = io();

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

// Завантажити збережені дані
const savedBotToken = localStorage.getItem('botToken');
const savedChatId = localStorage.getItem('chatId');
if (savedBotToken) botTokenInput.value = savedBotToken;
if (savedChatId) chatIdInput.value = savedChatId;

// Логи
socket.on('log', (data) => {
  addLog(data.message, data.type);
});

function addLog(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  
  const time = new Date().toLocaleTimeString('uk-UA');
  entry.innerHTML = `<span class="log-time">[${time}]</span>${message}`;
  
  logsContainer.appendChild(entry);
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

function setStatus(status, text) {
  const dot = statusIndicator.querySelector('.dot');
  dot.className = `dot ${status}`;
  statusText.textContent = text;
}

// Відкрити браузер
openBrowserBtn.addEventListener('click', async () => {
  openBrowserBtn.disabled = true;
  addLog('Відкриваю браузер...', 'info');
  
  try {
    const response = await fetch('/api/open-browser', { method: 'POST' });
    const data = await response.json();
    
    if (data.success) {
      saveSessionBtn.disabled = false;
      setStatus('active', 'Браузер відкрито');
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    addLog(`Помилка: ${error.message}`, 'error');
    openBrowserBtn.disabled = false;
  }
});

// Зберегти сесію
saveSessionBtn.addEventListener('click', async () => {
  saveSessionBtn.disabled = true;
  addLog('Зберігаю сесію...', 'info');
  
  try {
    const response = await fetch('/api/save-session', { method: 'POST' });
    const data = await response.json();
    
    if (data.success) {
      addLog('Сесію збережено! Можна запускати моніторинг', 'success');
      setStatus('', 'Готово до моніторингу');
      openBrowserBtn.disabled = false;
      startBtn.disabled = false;
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    addLog(`Помилка: ${error.message}`, 'error');
    saveSessionBtn.disabled = false;
  }
});

// Запустити моніторинг
startBtn.addEventListener('click', async () => {
  const botToken = botTokenInput.value.trim();
  const chatId = chatIdInput.value.trim();
  const interval = parseInt(intervalInput.value);
  
  if (!botToken || !chatId) {
    addLog('Вкажіть Bot Token і Chat ID', 'error');
    return;
  }
  
  // Зберегти в localStorage
  localStorage.setItem('botToken', botToken);
  localStorage.setItem('chatId', chatId);
  
  startBtn.disabled = true;
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
      stopBtn.disabled = false;
      openBrowserBtn.disabled = true;
      saveSessionBtn.disabled = true;
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    addLog(`Помилка: ${error.message}`, 'error');
    startBtn.disabled = false;
  }
});

// Зупинити моніторинг
stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  addLog('Зупиняю моніторинг...', 'info');
  
  try {
    const response = await fetch('/api/stop-monitoring', { method: 'POST' });
    const data = await response.json();
    
    if (data.success) {
      setStatus('', 'Зупинено');
      startBtn.disabled = false;
      openBrowserBtn.disabled = false;
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    addLog(`Помилка: ${error.message}`, 'error');
    stopBtn.disabled = false;
  }
});

// Очистити логи
clearLogsBtn.addEventListener('click', () => {
  logsContainer.innerHTML = '';
  addLog('Логи очищено', 'info');
});

// Модальне вікно
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

// Перевірка статусу при завантаженні
async function checkStatus() {
  try {
    const response = await fetch('/api/status');
    const data = await response.json();
    
    if (data.hasSession) {
      startBtn.disabled = false;
      addLog('Знайдено збережену сесію', 'success');
    }
    
    if (data.monitoring) {
      setStatus('monitoring', 'Моніторинг активний');
      stopBtn.disabled = false;
      startBtn.disabled = true;
    }
  } catch (error) {
    console.error(error);
  }
}

checkStatus();