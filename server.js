require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static('public'));

let browser = null;
let page = null;
let monitoringActive = false;
let monitorInterval = null;
let telegramBot = null;

const COOKIES_PATH = path.join(__dirname, 'cookies.json');
const URL = 'https://apm.iamlimitless.io/marketplace/order/12549';

// Ініціалізація Telegram бота
function initTelegramBot(token, chatId) {
  try {
    telegramBot = new TelegramBot(token, { polling: false });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Відправка логів на фронтенд
function sendLog(message, type = 'info') {
  console.log(message);
  io.emit('log', { message, type, timestamp: new Date().toISOString() });
}

// КРОК 1: Відкрити браузер для логіну
app.post('/api/open-browser', async (req, res) => {
  try {
    sendLog('🚀 Відкриваю браузер для авторизації...', 'info');

    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080'
      ]
    });

    page = await browser.newPage();
    await page.goto(URL, { waitUntil: 'networkidle2' });

    sendLog('✅ Браузер відкрито. Підключіть гаманець і авторизуйтесь', 'success');

    res.json({ success: true });
  } catch (error) {
    sendLog(`❌ Помилка: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// КРОК 2: Зберегти сесію після логіну
app.post('/api/save-session', async (req, res) => {
  try {
    if (!page) {
      throw new Error('Браузер не відкрито');
    }

    sendLog('💾 Зберігаю сесію...', 'info');

    const cookies = await page.cookies();
    const localStorage = await page.evaluate(() => {
      return JSON.stringify(localStorage);
    });

    const authData = {
      cookies,
      localStorage,
      timestamp: new Date().toISOString(),
      url: URL
    };

    fs.writeFileSync(COOKIES_PATH, JSON.stringify(authData, null, 2));

    sendLog('✅ Сесія збережена успішно!', 'success');

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

// КРОК 3: Запуск моніторингу
app.post('/api/start-monitoring', async (req, res) => {
  try {
    const { botToken, chatId, interval } = req.body;

    if (!botToken || !chatId) {
      throw new Error('Вкажіть Bot Token і Chat ID');
    }

    if (!fs.existsSync(COOKIES_PATH)) {
      throw new Error('Спочатку потрібно авторизуватись!');
    }

    // Ініціалізуємо Telegram
    const botInit = initTelegramBot(botToken, chatId);
    if (!botInit.success) {
      throw new Error('Невірний Telegram токен');
    }

    sendLog('🚀 Запускаю моніторинг...', 'info');

    // Відкриваємо headless браузер
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Завантажуємо сесію
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

    // Функція перевірки
    async function checkButton() {
      try {
        await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });

        const buttonInfo = await page.evaluate(() => {
          const button = document.querySelector('a[href*="/marketplace/order/"]');
          
          if (!button) return { exists: false };

          const classes = button.className;
          const isEnabled = !classes.includes('pointer-events-none') && 
                           !classes.includes('opacity-50');

          return {
            exists: true,
            isEnabled,
            text: button.textContent.trim()
          };
        });

        if (!buttonInfo.exists) {
          sendLog('⚠️ Кнопка не знайдена', 'warning');
          return;
        }

        const status = buttonInfo.isEnabled ? '✅ АКТИВНА' : '❌ Заблокована';
        sendLog(`🔍 Перевірка: ${status}`, 'info');

        // Якщо кнопка стала активною
        if (buttonInfo.isEnabled && !isButtonActive) {
          isButtonActive = true;
          sendLog('🎉 КНОПКА АКТИВНА! Відправляю повідомлення...', 'success');

          // Відправка в Telegram
          const message = `
🚨 *КНОПКА BUY АКТИВНА!* 🚨

✅ Можна купувати Order #12549

🔗 [Перейти до покупки](${URL})

⏰ ${new Date().toLocaleString('uk-UA')}
          `;

          await telegramBot.sendMessage(chatId, message, {
            parse_mode: 'Markdown'
          });

          // Скріншот
          const screenshotPath = `./screenshot-${Date.now()}.png`;
          await page.screenshot({ path: screenshotPath });
          await telegramBot.sendPhoto(chatId, screenshotPath);

          sendLog('✅ Повідомлення відправлено в Telegram', 'success');
        }

        if (!buttonInfo.isEnabled && isButtonActive) {
          isButtonActive = false;
          sendLog('⚠️ Кнопка знову заблокована', 'warning');
        }

      } catch (error) {
        sendLog(`❌ Помилка перевірки: ${error.message}`, 'error');
      }
    }

    // Перша перевірка
    await checkButton();

    // Періодична перевірка
    monitorInterval = setInterval(checkButton, interval * 1000);

    sendLog(`✅ Моніторинг запущено (інтервал: ${interval}с)`, 'success');

    res.json({ success: true });

  } catch (error) {
    sendLog(`❌ Помилка запуску: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// КРОК 4: Зупинка моніторингу
app.post('/api/stop-monitoring', async (req, res) => {
  try {
    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }

    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }

    monitoringActive = false;

    sendLog('🛑 Моніторинг зупинено', 'info');

    res.json({ success: true });
  } catch (error) {
    sendLog(`❌ Помилка зупинки: ${error.message}`, 'error');
    res.status(500).json({ success: false, error: error.message });
  }
});

// Перевірка статусу
app.get('/api/status', (req, res) => {
  res.json({
    monitoring: monitoringActive,
    hasSession: fs.existsSync(COOKIES_PATH),
    browserOpen: browser !== null
  });
});

// WebSocket з'єднання
io.on('connection', (socket) => {
  sendLog('👤 Клієнт підключено', 'info');
  
  socket.on('disconnect', () => {
    sendLog('👤 Клієнт відключено', 'info');
  });
});

const PORT = process.env.PORT || 2121;
server.listen(PORT, () => {
  console.log(`🌐 Сервер запущено: http://localhost:${PORT}`);
});
