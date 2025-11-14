require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

let browser = null;
let page = null;
let monitoringActive = false;
let monitorInterval = null;
let telegramBot = null;
let xvfbProcess = null;
let vncProcess = null;
let novncProcess = null;

const COOKIES_PATH = path.join(__dirname, 'cookies.json');
const URL = 'https://apm.iamlimitless.io/marketplace/order/12549';

// Запуск Xvfb
function startXvfb() {
  return new Promise((resolve) => {
    if (xvfbProcess) {
      resolve();
      return;
    }
    
    console.log('Starting Xvfb...');
    xvfbProcess = spawn('Xvfb', [':99', '-screen', '0', '1920x1080x24', '-ac']);
    process.env.DISPLAY = ':99';
    
    xvfbProcess.on('error', (err) => {
      console.error('Xvfb error:', err);
    });
    
    xvfbProcess.stderr.on('data', (data) => {
      console.error('Xvfb stderr:', data.toString());
    });
    
    setTimeout(() => {
      console.log('Xvfb started on display :99');
      resolve();
    }, 2000);
  });
}

// Запуск VNC сервера
function startVNC() {
  return new Promise((resolve) => {
    if (vncProcess) {
      resolve();
      return;
    }
    
    console.log('Starting x11vnc...');
    vncProcess = spawn('x11vnc', [
      '-display', ':99',
      '-forever',
      '-shared',
      '-rfbport', '5900',
      '-nopw',
      '-quiet'
    ]);
    
    vncProcess.on('error', (err) => {
      console.error('VNC error:', err);
    });
    
    vncProcess.stderr.on('data', (data) => {
      console.error('VNC stderr:', data.toString());
    });
    
    setTimeout(() => {
      console.log('VNC server started on port 5900');
      resolve();
    }, 2000);
  });
}

// Запуск noVNC (веб-інтерфейс для VNC)
function startNoVNC() {
  return new Promise((resolve) => {
    if (novncProcess) {
      resolve();
      return;
    }
    
    console.log('Starting noVNC...');
    novncProcess = spawn('/opt/noVNC/utils/novnc_proxy', [
      '--vnc', 'localhost:5900',
      '--listen', '6080'
    ]);
    
    novncProcess.on('error', (err) => {
      console.error('noVNC error:', err);
    });
    
    novncProcess.stdout.on('data', (data) => {
      console.log('noVNC:', data.toString());
    });
    
    novncProcess.stderr.on('data', (data) => {
      console.error('noVNC stderr:', data.toString());
    });
    
    setTimeout(() => {
      console.log('noVNC web server started on port 6080');
      resolve();
    }, 3000);
  });
}

// Ініціалізація Telegram бота
function initTelegramBot(token) {
  try {
    telegramBot = new TelegramBot(token, { polling: false });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Відправка логів на фронтенд
function sendLog(message, type = 'info') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${type}] ${message}`);
  io.emit('log', { message, type, timestamp });
}

// ENDPOINT: Відкрити браузер з VNC
app.post('/api/open-browser', async (req, res) => {
  try {
    sendLog('🚀 Запускаю віртуальний дисплей...', 'info');
    
    // Запускаємо Xvfb
    await startXvfb();
    sendLog('✅ Віртуальний дисплей запущено', 'success');

    // Запускаємо VNC
    sendLog('🖥️ Запускаю VNC сервер...', 'info');
    await startVNC();
    sendLog('✅ VNC сервер запущено', 'success');

    // Запускаємо noVNC
    sendLog('🌐 Запускаю веб VNC...', 'info');
    await startNoVNC();
    sendLog('✅ Веб VNC запущено', 'success');

    sendLog('🌐 Відкриваю браузер...', 'info');

    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    page = await browser.newPage();
    
    sendLog('📡 Підключаюсь до сайту...', 'info');
    await page.goto(URL, { 
      waitUntil: 'networkidle2',
      timeout: 60000 
    });

    sendLog('✅ Браузер відкрито!', 'success');
    sendLog('👀 Тепер ви можете побачити браузер у вікні VNC', 'info');
    sendLog('🔐 Підключіть гаманець і авторизуйтесь', 'info');

    res.json({ 
      success: true,
      vncUrl: '/vnc/vnc.html'
    });
  } catch (error) {
    sendLog(`❌ Помилка: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// ENDPOINT: Зберегти сесію після логіну
app.post('/api/save-session', async (req, res) => {
  try {
    if (!page) {
      throw new Error('Браузер не відкрито. Спочатку натисніть "Відкрити браузер"');
    }

    sendLog('💾 Зберігаю сесію...', 'info');

    const cookies = await page.cookies();
    const localStorage = await page.evaluate(() => {
      return JSON.stringify(window.localStorage);
    });

    const authData = {
      cookies,
      localStorage,
      timestamp: new Date().toISOString(),
      url: URL
    };

    fs.writeFileSync(COOKIES_PATH, JSON.stringify(authData, null, 2));

    sendLog('✅ Сесію збережено успішно!', 'success');
    sendLog('🎯 Тепер можна запускати моніторинг', 'info');

    // Закриваємо браузер
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }

    res.json({ success: true });
  } catch (error) {
    sendLog(`❌ Помилка збереження: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// ENDPOINT: Запуск моніторингу
app.post('/api/start-monitoring', async (req, res) => {
  try {
    const { botToken, chatId, interval } = req.body;

    if (!botToken || !chatId) {
      throw new Error('Вкажіть Bot Token і Chat ID');
    }

    if (!fs.existsSync(COOKIES_PATH)) {
      throw new Error('Спочатку потрібно авторизуватись!');
    }

    const botInit = initTelegramBot(botToken);
    if (!botInit.success) {
      throw new Error('Невірний Telegram токен');
    }

    sendLog('🚀 Запускаю моніторинг...', 'info');

    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    sendLog('🔐 Завантажую збережену сесію...', 'info');
    const authData = JSON.parse(fs.readFileSync(COOKIES_PATH));
    
    await page.setCookie(...authData.cookies);
    await page.goto(URL, { waitUntil: 'domcontentloaded' });

    if (authData.localStorage) {
      await page.evaluate((localStorageData) => {
        const data = JSON.parse(localStorageData);
        for (let key in data) {
          localStorage.setItem(key, data[key]);
        }
      }, authData.localStorage);
    }

    sendLog('✅ Сесію завантажено', 'success');

    monitoringActive = true;
    let isButtonActive = false;

    async function checkButton() {
      if (!monitoringActive) return;

      try {
        await page.goto(URL, { 
          waitUntil: 'networkidle2', 
          timeout: 30000 
        });

        await page.waitForTimeout(2000);

        const buttonInfo = await page.evaluate(() => {
          const button = document.querySelector('a[href*="/marketplace/order/"]');
          
          if (!button) return { exists: false };

          const classes = button.className;
          const isEnabled = !classes.includes('pointer-events-none') && 
                           !classes.includes('opacity-50');

          return {
            exists: true,
            isEnabled,
            text: button.textContent.trim(),
            classes: classes
          };
        });

        if (!buttonInfo.exists) {
          sendLog('⚠️ Кнопка не знайдена (можливо сесія застаріла)', 'warning');
          return;
        }

        const status = buttonInfo.isEnabled ? '✅ АКТИВНА' : '❌ Заблокована';
        sendLog(`🔍 Перевірка: Кнопка "${buttonInfo.text}" - ${status}`, 'info');

        if (buttonInfo.isEnabled && !isButtonActive) {
          isButtonActive = true;
          sendLog('🎉 КНОПКА СТАЛА АКТИВНОЮ! Відправляю повідомлення...', 'success');

          const message = `
🚨 *КНОПКА BUY АКТИВНА!* 🚨

✅ Можна купувати Order #12549

🔗 [Перейти до покупки](${URL})

⏰ ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' })}
          `;

          await telegramBot.sendMessage(chatId, message, {
            parse_mode: 'Markdown'
          });

          const screenshotPath = path.join(__dirname, `screenshot-${Date.now()}.png`);
          await page.screenshot({ 
            path: screenshotPath,
            fullPage: false 
          });
          
          await telegramBot.sendPhoto(chatId, screenshotPath, {
            caption: '📸 Скріншот активної кнопки'
          });

          sendLog('✅ Повідомлення відправлено в Telegram', 'success');

          setTimeout(() => {
            if (fs.existsSync(screenshotPath)) {
              fs.unlinkSync(screenshotPath);
            }
          }, 5000);
        }

        if (!buttonInfo.isEnabled && isButtonActive) {
          isButtonActive = false;
          sendLog('⚠️ Кнопка знову заблокована', 'warning');
        }

      } catch (error) {
        sendLog(`❌ Помилка перевірки: ${error.message}`, 'error');
      }
    }

    await checkButton();
    monitorInterval = setInterval(checkButton, interval * 1000);

    sendLog(`✅ Моніторинг запущено (інтервал: ${interval} секунд)`, 'success');

    res.json({ success: true });

  } catch (error) {
    sendLog(`❌ Помилка запуску: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// ENDPOINT: Зупинка моніторингу
app.post('/api/stop-monitoring', async (req, res) => {
  try {
    monitoringActive = false;

    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }

    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }

    sendLog('🛑 Моніторинг зупинено', 'info');

    res.json({ success: true });
  } catch (error) {
    sendLog(`❌ Помилка зупинки: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// ENDPOINT: Перевірка статусу
app.get('/api/status', (req, res) => {
  res.json({
    monitoring: monitoringActive,
    hasSession: fs.existsSync(COOKIES_PATH),
    browserOpen: browser !== null
  });
});

// Проксі для noVNC
app.use('/vnc', express.static('/opt/noVNC'));

// WebSocket
io.on('connection', (socket) => {
  console.log('Client connected');
  sendLog('👤 Клієнт підключено до веб-інтерфейсу', 'info');
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\nShutting down...');
  
  monitoringActive = false;
  
  if (monitorInterval) clearInterval(monitorInterval);
  if (browser) await browser.close();
  if (xvfbProcess) xvfbProcess.kill();
  if (vncProcess) vncProcess.kill();
  if (novncProcess) novncProcess.kill();
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  if (xvfbProcess) xvfbProcess.kill();
  if (vncProcess) vncProcess.kill();
  if (novncProcess) novncProcess.kill();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   Buy Button Monitor + VNC             ║
║   Server: http://localhost:${PORT}       ║
║   VNC: http://localhost:6080/vnc.html  ║
╚════════════════════════════════════════╝
  `);
});