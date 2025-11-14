require('dotenv').config();
const puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

class BuyButtonMonitor {
  constructor() {
    this.browser = null;
    this.page = null;
    this.cookiesPath = path.join(__dirname, 'cookies.json');
    this.isButtonActive = false;
    this.checkInterval = parseInt(process.env.CHECK_INTERVAL) || 30000;
    this.url = 'https://apm.iamlimitless.io/marketplace/order/12549';
  }

  // КРОК 1: Ручний логін (виконується один раз)
  async setupAuth() {
    console.log('\n🔐 === РЕЖИМ НАЛАШТУВАННЯ АВТОРИЗАЦІЇ ===\n');
    console.log('Зараз відкриється браузер.');
    console.log('Ваші дії:');
    console.log('1. Підключіть криптогаманець');
    console.log('2. Авторизуйтесь на сайті');
    console.log('3. Переконайтесь що бачите сторінку з кнопкою Buy');
    console.log('4. Поверніться в термінал і натисніть Enter\n');

    this.browser = await puppeteer.launch({
      headless: false, // Відкритий браузер
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1920,1080'
      ],
      defaultViewport: null
    });

    this.page = await this.browser.newPage();
    
    await this.page.goto(this.url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    console.log('✅ Браузер відкрито. Виконайте авторизацію...\n');

    // Чекаємо на Enter
    await this.waitForEnter();

    // Зберігаємо cookies та localStorage
    const cookies = await this.page.cookies();
    const localStorage = await this.page.evaluate(() => {
      return JSON.stringify(localStorage);
    });

    const authData = {
      cookies,
      localStorage,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync(this.cookiesPath, JSON.stringify(authData, null, 2));
    
    console.log('\n✅ Сесія успішно збережена у cookies.json');
    console.log('✅ Тепер можна запускати моніторинг!\n');

    await this.browser.close();
  }

  waitForEnter() {
    return new Promise(resolve => {
      console.log('👉 Натисніть Enter після успішної авторизації...');
      process.stdin.once('data', () => {
        resolve();
      });
    });
  }

  // КРОК 2: Ініціалізація з збереженою сесією
  async init() {
    if (!fs.existsSync(this.cookiesPath)) {
      console.error('❌ Файл cookies.json не знайдено!');
      console.error('Спочатку запустіть: node monitor.js setup\n');
      process.exit(1);
    }

    const authData = JSON.parse(fs.readFileSync(this.cookiesPath));
    
    console.log(`🍪 Завантажено сесію від ${authData.timestamp}`);

    this.browser = await puppeteer.launch({
      headless: 'new', // Headless режим
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    this.page = await this.browser.newPage();
    
    await this.page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );
    
    await this.page.setViewport({ width: 1920, height: 1080 });

    // Відновлюємо cookies
    if (authData.cookies && authData.cookies.length > 0) {
      await this.page.setCookie(...authData.cookies);
    }

    // Відновлюємо localStorage
    await this.page.goto(this.url, { waitUntil: 'domcontentloaded' });
    
    if (authData.localStorage) {
      await this.page.evaluate((localStorageData) => {
        const data = JSON.parse(localStorageData);
        for (let key in data) {
          localStorage.setItem(key, data[key]);
        }
      }, authData.localStorage);
    }

    console.log('✅ Браузер ініціалізовано з авторизацією\n');
  }

  // КРОК 3: Перевірка стану кнопки
  async checkButton() {
    try {
      await this.page.goto(this.url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Чекаємо появи кнопки
      await this.page.waitForSelector('a[href*="/marketplace/order/"]', {
        timeout: 10000
      }).catch(() => {
        console.log('⚠️ Кнопка не знайдена - можливо сесія застаріла');
      });

      const buttonInfo = await this.page.evaluate(() => {
        const button = document.querySelector('a[href*="/marketplace/order/"]');
        
        if (!button) {
          return { exists: false };
        }

        const classes = button.className;
        const hasPointerEvents = !classes.includes('pointer-events-none');
        const hasFullOpacity = !classes.includes('opacity-50');
        const isEnabled = hasPointerEvents && hasFullOpacity;

        return {
          exists: true,
          isEnabled: isEnabled,
          text: button.textContent.trim(),
          href: button.href,
          hasPointerEvents,
          hasFullOpacity,
          allClasses: classes
        };
      });

      if (!buttonInfo.exists) {
        console.log('❌ Кнопка не знайдена на сторінці');
        console.log('💡 Можливо потрібна реавторизація. Запустіть: node monitor.js setup');
        return false;
      }

      const status = buttonInfo.isEnabled ? '✅ АКТИВНА' : '❌ ЗАБЛОКОВАНА';
      console.log(`📊 Кнопка "${buttonInfo.text}": ${status}`);
      console.log(`   - Pointer events: ${buttonInfo.hasPointerEvents ? '✅' : '❌'}`);
      console.log(`   - Opacity: ${buttonInfo.hasFullOpacity ? '✅' : '❌'}`);

      // Відправка повідомлення якщо кнопка стала активною
      if (buttonInfo.isEnabled && !this.isButtonActive) {
        console.log('\n🎉 КНОПКА СТАЛА АКТИВНОЮ! Відправка повідомлення...\n');
        await this.sendTelegramAlert(buttonInfo);
        await this.takeScreenshot();
      }

      // Відстеження зміни статусу назад
      if (!buttonInfo.isEnabled && this.isButtonActive) {
        console.log('⚠️ Кнопка знову заблокована');
      }

      this.isButtonActive = buttonInfo.isEnabled;
      return buttonInfo.isEnabled;

    } catch (error) {
      console.error('❌ Помилка перевірки:', error.message);
      
      // Якщо помилка авторизації - повідомляємо
      if (error.message.includes('net::ERR') || error.message.includes('timeout')) {
        console.log('💡 Можлива проблема з мережею або авторизацією');
      }
      
      return false;
    }
  }

  // Відправка повідомлення в Telegram
  async sendTelegramAlert(buttonInfo) {
    try {
      const message = `
🚨 *УВАГА! КНОПКА BUY АКТИВНА!* 🚨

✅ Зараз можна здійснити покупку

📦 *Order:* #12549
🔗 *Посилання:* [Перейти до покупки](${this.url})

⏰ *Час:* ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' })}

Поспішайте! 🏃‍♂️
      `.trim();

      await bot.sendMessage(
        process.env.TELEGRAM_CHAT_ID,
        message,
        { 
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        }
      );

      console.log('✅ Telegram повідомлення відправлено');
      
    } catch (error) {
      console.error('❌ Помилка Telegram:', error.message);
    }
  }

  // Скріншот для доказу
  async takeScreenshot() {
    try {
      const timestamp = Date.now();
      const filename = `buy-active-${timestamp}.png`;
      const filepath = path.join(__dirname, 'screenshots', filename);

      await this.page.screenshot({
        path: filepath,
        fullPage: false
      });

      console.log(`📸 Скріншот збережено: ${filename}`);

      // Відправка скріншоту в Telegram
      await bot.sendPhoto(
        process.env.TELEGRAM_CHAT_ID,
        filepath,
        { caption: '📸 Підтвердження активної кнопки' }
      );

      console.log('✅ Скріншот відправлено в Telegram');

    } catch (error) {
      console.error('❌ Помилка скріншоту:', error.message);
    }
  }

  // КРОК 4: Запуск моніторингу
  async startMonitoring() {
    await this.init();

    console.log('🚀 === МОНІТОРИНГ ЗАПУЩЕНО ===');
    console.log(`📍 URL: ${this.url}`);
    console.log(`⏰ Інтервал перевірки: ${this.checkInterval / 1000} секунд`);
    console.log(`📱 TelegramChat ID: ${process.env.TELEGRAM_CHAT_ID}`);
    console.log('=' .repeat(50) + '\n');

    // Перша перевірка одразу
    await this.checkButton();

    // Періодична перевірка
    this.monitorInterval = setInterval(async () => {
      const time = new Date().toLocaleTimeString('uk-UA');
      console.log(`\n🔍 [${time}] Перевірка...`);
      await this.checkButton();
    }, this.checkInterval);
  }

  // Зупинка моніторингу
  async stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    
    if (this.browser) {
      await this.browser.close();
    }
    
    console.log('\n🛑 Моніторинг зупинено');
  }
}

// === ЗАПУСК ===
const monitor = new BuyButtonMonitor();

const command = process.argv[2];

if (command === 'setup') {
  // Режим налаштування авторизації
  monitor.setupAuth()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('💥 Помилка:', error);
      process.exit(1);
    });
} else {
  // Звичайний моніторинг
  monitor.startMonitoring()
    .catch(error => {
      console.error('💥 Критична помилка:', error);
      process.exit(1);
    });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n\n👋 Отримано сигнал зупинки...');
    await monitor.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await monitor.stop();
    process.exit(0);
  });
}