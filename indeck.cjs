require('dotenv').config();
const { Telegraf, session, Markup } = require('telegraf');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// ==================================================
// CONFIG & CONSTANTS
// ==================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => Number(id.trim()))
  .filter(id => !isNaN(id));

const DB_PATH = path.join(__dirname, 'bot_database.sqlite');

if (!BOT_TOKEN) {
  console.error("XATOLIK: BOT_TOKEN topilmadi! .env faylini tekshiring.");
  process.exit(1);
}

const STATUS = {
  NEW: 'Yangi',
  PENDING_PAYMENT: 'To‘lov kutilmoqda',
  PENDING_VERIFY: 'To‘lov tekshirilmoqda',
  CONFIRMED: 'Tasdiqlandi',
  PROCESSING: 'Jarayonda',
  COMPLETED: 'Bajarildi',
  CANCELED: 'Bekor qilindi',
};

const PAYMENT_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

const SUPPORT_STATUS = {
  OPEN: 'open',
  CLOSED: 'closed',
};

// ==================================================
// DATABASE
// ==================================================
const db = new sqlite3.Database(DB_PATH);

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

const dbAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

async function ensureColumn(table, column, definition) {
  const columns = await dbAll(`PRAGMA table_info(${table})`);
  const exists = columns.some((c) => c.name === column);
  if (!exists) {
    await dbRun(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

async function initDB() {
  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    role TEXT DEFAULT 'user',
    join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
    order_count INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER UNIQUE,
    title TEXT,
    type TEXT,
    username TEXT,
    invite_link TEXT,
    added_date DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER,
    title TEXT,
    short_desc TEXT,
    full_desc TEXT,
    price INTEGER,
    old_price INTEGER,
    est_time TEXT,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    required_fields TEXT,
    sort_order INTEGER DEFAULT 0
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS premium_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    duration TEXT,
    price INTEGER,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS stars_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    amount INTEGER,
    price INTEGER,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id_str TEXT UNIQUE,
    user_id INTEGER,
    service_type TEXT,
    service_id INTEGER,
    amount INTEGER,
    status TEXT,
    data TEXT,
    admin_comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    user_id INTEGER,
    method_id INTEGER,
    proof_type TEXT,
    proof_value TEXT,
    status TEXT DEFAULT 'pending',
    admin_reason TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    type TEXT,
    account_details TEXT,
    holder_name TEXT,
    instruction TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS support_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    message_text TEXT,
    admin_reply TEXT,
    status TEXT DEFAULT 'open',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Migrations for old DB
  await ensureColumn('users', 'first_name', 'TEXT');
  await ensureColumn('users', 'last_name', 'TEXT');
  await ensureColumn('users', 'username', 'TEXT');
  await ensureColumn('users', 'role', "TEXT DEFAULT 'user'");
  await ensureColumn('users', 'join_date', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('users', 'last_active', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('users', 'order_count', 'INTEGER DEFAULT 0');
  await ensureColumn('users', 'is_banned', 'INTEGER DEFAULT 0');

  await ensureColumn('orders', 'admin_comment', 'TEXT');
  await ensureColumn('orders', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('payments', 'admin_reason', 'TEXT');

  const settingsCount = await dbGet(`SELECT COUNT(*) as count FROM settings`);
  if (!settingsCount || settingsCount.count === 0) {
    const defaultSettings = [
      ['brand_name', 'HALOL DIGITAL SERVICES'],
      [
        'welcome_text',
        'Assalomu alaykum!\n\nBizning rasmiy botimizga xush kelibsiz.\n\nBu yerda siz Telegram Premium, Telegram Stars va boshqa raqamli xizmatlarni xavfsiz va halol yo‘l bilan buyurtma qilishingiz mumkin.',
      ],
      ['support_username', '@pro_xizmat1'],
      ['support_text', 'Savollaringiz bo‘lsa, bizga yozing.'],
      [
        'rules_text',
        '1. To‘lov tasdiqlangach buyurtma bajariladi.\n2. Noto‘g‘ri ma’lumot berilsa buyurtma bekor qilinishi mumkin.\n3. Parol hech qachon so‘ralmaydi.\n4. Chek noto‘g‘ri bo‘lsa qayta yuborish so‘raladi.',
      ],
      [
        'faq_text',
        'Savol: Premium qanday yuboriladi?\nJavob: Rasmiy gift tarzida yuboriladi.\n\nSavol: Parol kerakmi?\nJavob: Yo‘q, parol so‘ralmaydi.',
      ],
      ['footer_text', 'SMM Roscket - Nakrutka xizmatlari'],
      ['working_hours', '24/7'],
      ['order_prefix', 'ORD'],
      ['stickers_enabled', '0'],
      ['auto_delete_enabled', '0'],
    ];

    for (const [k, v] of defaultSettings) {
      await dbRun(`INSERT INTO settings (key, value) VALUES (?, ?)`, [k, v]);
    }

    await dbRun(`INSERT INTO categories (name, sort_order) VALUES (?, ?)`, ['Telegram Premium', 1]);
    await dbRun(`INSERT INTO categories (name, sort_order) VALUES (?, ?)`, ['Telegram Stars', 2]);
    await dbRun(`INSERT INTO categories (name, sort_order) VALUES (?, ?)`, ['Instagram, Facebook Nakrutka', 3]);
    await dbRun(`INSERT INTO categories (name, sort_order) VALUES (?, ?)`, ['YouTube Nakrutka', 4]);
    await dbRun(`INSERT INTO categories (name, sort_order) VALUES (?, ?)`, ['TikTok Nakrutka', 5]);
    await dbRun(`INSERT INTO categories (name, sort_order) VALUES (?, ?)`, ['Telegram Nakrutka', 6]);

    await dbRun(
      `INSERT INTO premium_packages (title, duration, price, description, sort_order) VALUES (?, ?, ?, ?, ?)`,
      ['1 Oylik', '1 oy', 55000`so'm`, '1 oylik rasmiy Telegram Premium', 1]
    );
    await dbRun(
      `INSERT INTO premium_packages (title, duration, price, description, sort_order) VALUES (?, ?, ?, ?, ?)`,
      ['3 Oylik', '3 oy', 190000`so'm`, '3 oylik rasmiy Telegram Premium', 2]
    );
    await dbRun(
      `INSERT INTO premium_packages (title, duration, price, description, sort_order) VALUES (?, ?, ?, ?, ?)`,
      ['6 Oylik', '6 oy', 270000`so'm`, '6 oylik rasmiy Telegram Premium', 3]
    );
    await dbRun(
      `INSERT INTO premium_packages (title, duration, price, description, sort_order) VALUES (?, ?, ?, ?, ?)`,
      ['12 Oylik', '12 oy', 340000`so'm`, '12 oylik rasmiy Telegram Premium', 4]
    );

    await dbRun(
      `INSERT INTO stars_packages (title, amount, price, description, sort_order) VALUES (?, ?, ?, ?, ?)`,
      ['100 Stars', 100, 25000, '100 ta Telegram Stars', 1]
    );
    await dbRun(
      `INSERT INTO stars_packages (title, amount, price, description, sort_order) VALUES (?, ?, ?, ?, ?)`,
      ['500 Stars', 500, 110000, '500 ta Telegram Stars', 2]
    );

    await dbRun(
      `INSERT INTO payment_methods (title, type, account_details, holder_name, instruction, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'Uzcard',
        'card',
        '8600 0000 0000 0000',
        'Falonchiyev Pistonchi',
        'Karta raqamiga o‘tkazma qiling va chekni yuboring.',
        1,
      ]
    );

    await dbRun(
      `INSERT INTO services (category_id, title, short_desc, full_desc, price, old_price, est_time, notes, required_fields, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        1,
        'Telegram kanal reklama',
        'Telegram kanal uchun reklama xizmati',
        'Kanal reklama xizmati bo‘yicha buyurtma qabul qilinadi. Kerakli ma’lumotlarni yuboring.',
        50000,
        null,
        '1-24 soat',
        'Link to‘g‘ri bo‘lishi shart.',
        JSON.stringify([
          { key: 'channel_link', label: 'Kanal linki', type: 'link', example: 'https://t.me/channelname' },
          { key: 'comment', label: 'Izoh', type: 'text', example: 'Qisqacha izoh yozing' },
        ]),
        1,
      ]
    );
  }
}

// ==================================================
// HELPERS
// ==================================================
async function getSetting(key) {
  const row = await dbGet(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row ? row.value : null;
}

async function logAction(action, details = {}) {
  try {
    await dbRun(`INSERT INTO logs (action, details) VALUES (?, ?)`, [action, JSON.stringify(details)]);
  } catch (e) {
    console.error('Log yozishda xato:', e.message);
  }
}

function formatPrice(price) {
  const n = Number(price || 0);
  return `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;
}

function escapeMd(text) {
  return String(text ?? '')
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function validateUsername(username) {
  return /^@?[a-zA-Z0-9_]{5,32}$/.test(String(username).trim());
}

function validateTelegramTarget(text) {
  const value = String(text).trim();
  return (
    validateUsername(value) ||
    /^https?:\/\/(t\.me|telegram\.me)\/[a-zA-Z0-9_]{5,32}$/.test(value) ||
    /^\d{5,15}$/.test(value)
  );
}

function validateLink(link) {
  return /^(https?:\/\/)?(www\.)?(t\.me|telegram\.me|instagram\.com|youtube\.com|youtu\.be)\/.+/i.test(
    String(link).trim()
  );
}

function validateField(field, value) {
  const v = String(value || '').trim();
  if (!v) return { ok: false, msg: 'Bo‘sh qiymat yuborilmadi. Iltimos, qayta urinib ko‘ring.' };

  if (field.type === 'username' && !validateUsername(v)) {
    return { ok: false, msg: 'Xato format. Namuna: @username' };
  }
  if (field.type === 'link' && !validateLink(v)) {
    return { ok: false, msg: 'Xato format. Iltimos, to‘g‘ri link yuboring.' };
  }
  return { ok: true };
}

function resetSession(ctx) {
  ctx.session = {};
}

async function sendMainMenu(ctx, text) {
  return ctx.reply(text, Keyboards.mainMenu(ctx.state.isAdmin));
}

async function safeAnswerCb(ctx, text) {
  try {
    await ctx.answerCbQuery(text);
  } catch (_) {}
}

async function safeEditOrReply(ctx, text, extra = {}) {
  try {
    if (ctx.updateType === 'callback_query') {
      return await ctx.editMessageText(text, extra);
    }
    return await ctx.reply(text, extra);
  } catch (_) {
    return ctx.reply(text, extra);
  }
}

async function getOrderDisplayName(order) {
  if (!order) return 'Noma’lum xizmat';
  if (order.service_type === 'service') {
    const srv = await dbGet(`SELECT title FROM services WHERE id = ?`, [order.service_id]);
    return srv ? srv.title : `Xizmat #${order.service_id}`;
  }
  if (order.service_type === 'premium') {
    const pkg = await dbGet(`SELECT title FROM premium_packages WHERE id = ?`, [order.service_id]);
    return pkg ? `Telegram Premium - ${pkg.title}` : 'Telegram Premium';
  }
  if (order.service_type === 'stars') {
    const pkg = await dbGet(`SELECT title FROM stars_packages WHERE id = ?`, [order.service_id]);
    return pkg ? `Telegram Stars - ${pkg.title}` : 'Telegram Stars';
  }
  return 'Noma’lum xizmat';
}

async function notifyAdmins(text, extra = {}) {
  for (const adminId of ADMIN_IDS) {
    try {
      await bot.telegram.sendMessage(adminId, text, extra);
    } catch (_) {}
  }
}

function prettyJsonData(dataText) {
  try {
    const obj = JSON.parse(dataText || '{}');
    const lines = [];
    for (const [k, v] of Object.entries(obj)) {
      lines.push(`• ${k}: ${v}`);
    }
    return lines.length ? lines.join('\n') : 'Ma’lumot yo‘q';
  } catch (_) {
    return String(dataText || 'Ma’lumot yo‘q');
  }
}

// ==================================================
// KEYBOARDS
// ==================================================
const Keyboards = {
  mainMenu: (isAdmin = false) => {
    const buttons = [
      ['🛍 Xizmatlar', '💎 Telegram Premium'],
      ['⭐ Telegram Stars', '📦 Buyurtmalarim'],
      ['💳 To‘lov qilish', '📩 Bog‘lanish'],
      ['ℹ️ Qoidalar', '❓ Yordam'],
      ['🏠 Bosh menyu'],
    ];
    if (isAdmin) buttons.push(['⚙️ Admin panel']);
    return Markup.keyboard(buttons).resize();
  },

  adminMenu: () =>
    Markup.keyboard([
      ['📊 Statistika', '📦 Buyurtmalar'],
      ['💰 To‘lovlar', '🛍 Xizmatlar'],
      ['🗂 Kategoriyalar', '👥 Foydalanuvchilar'],
      ['📣 Xabar yuborish', '🧾 To‘lov usullari'],
      ['⚙️ Sozlamalar', '🛡 Xavfsizlik'],
      ['📝 Loglar', '🏠 User menyu'],
      ['❌ Yopish'],
    ]).resize(),

  cancel: () => Markup.keyboard([['❌ Bekor qilish']]).resize(),
  back: () => Markup.keyboard([['🔙 Orqaga'], ['❌ Bekor qilish']]).resize(),
};

// ==================================================
// BOT
// ==================================================
const bot = new Telegraf(BOT_TOKEN);
bot.use(session({ defaultSession: () => ({}) }));

// ==================================================
// MIDDLEWARE
// ==================================================
bot.use(async (ctx, next) => {
  try {
    if (!ctx || !ctx.from || !ctx.chat) {
      return next();
    }

    const isPrivate = ctx.chat.type === 'private';
    const telegramId = Number(ctx.from.id);

    if (!ctx.state) ctx.state = {};

    let user = await dbGet(`SELECT * FROM users WHERE telegram_id = ?`, [telegramId]);

    if (!user) {
      await dbRun(
        `INSERT INTO users (
          telegram_id,
          first_name,
          last_name,
          username,
          role,
          join_date,
          last_active,
          order_count,
          is_banned
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0, 0)`,
        [
          telegramId,
          ctx.from.first_name || '',
          ctx.from.last_name || '',
          ctx.from.username || '',
          'user'
        ]
      );
    } else {
      await dbRun(
        `UPDATE users
         SET first_name = ?,
             last_name = ?,
             username = ?,
             last_active = CURRENT_TIMESTAMP
         WHERE telegram_id = ?`,
        [
          ctx.from.first_name || '',
          ctx.from.last_name || '',
          ctx.from.username || '',
          telegramId
        ]
      );
    }

    user = await dbGet(`SELECT * FROM users WHERE telegram_id = ?`, [telegramId]);

    ctx.state.user = user || null;

    const envAdmin = ADMIN_IDS.includes(telegramId);
    const dbAdmin = user && user.role === 'admin';
    ctx.state.isAdmin = Boolean(envAdmin || dbAdmin);

    if (user && Number(user.is_banned) === 1) {
      if (isPrivate) {
        await ctx.reply('Sizning hisobingiz bloklangan. Iltimos, admin bilan bog‘laning.');
      }
      return;
    }

    if (!isPrivate) {
      await dbRun(
        `INSERT INTO chats (chat_id, title, type, username, invite_link, added_date)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(chat_id) DO UPDATE SET
           title = excluded.title,
           type = excluded.type,
           username = excluded.username`,
        [
          ctx.chat.id,
          ctx.chat.title || '',
          ctx.chat.type || '',
          ctx.chat.username || '',
          null
        ]
      );

      if (
        ctx.message &&
        typeof ctx.message.text === 'string' &&
        ctx.message.text.startsWith('/start')
      ) {
        const botUsername =
          (ctx.botInfo && ctx.botInfo.username) ? ctx.botInfo.username : 'your_bot';

        await ctx.reply(
          `Bu bot asosan shaxsiy chatda ishlaydi. Iltimos, botga shaxsiy chatda yozing: @${botUsername}`
        );
        return;
      }
    }

    return next();
  } catch (err) {
    console.error('Middleware xatosi:', err);
    try {
      await ctx.reply(
        '🌐 Hozircha aloqa bilan kichik muammo kuzatilmoqda. Iltimos, birozdan keyin qayta urinib ko‘ring.'
      );
    } catch (_) {}
  }
});

// ==================================================
// COMMANDS
// ==================================================
bot.start(async (ctx) => {
  if (ctx.chat.type !== 'private') return;

  const welcomeText = await getSetting('welcome_text');
  const brandName = await getSetting('brand_name');

  await ctx.sendChatAction('typing');
  await ctx.reply(`🌟 ${brandName}\n\n${welcomeText}`, Keyboards.mainMenu(ctx.state.isAdmin));
});

bot.command('menu', async (ctx) => {
  await ctx.reply('Asosiy menyu:', Keyboards.mainMenu(ctx.state.isAdmin));
});

bot.command('cancel', async (ctx) => {
  resetSession(ctx);
  await ctx.reply('Amal bekor qilindi.', Keyboards.mainMenu(ctx.state.isAdmin));
});

bot.command('admin', async (ctx) => {
  if (!ctx.state.isAdmin) return ctx.reply('Bu bo‘lim faqat adminlar uchun.');
  return ctx.reply('Admin panelga xush kelibsiz:', Keyboards.adminMenu());
});

bot.command('stats', async (ctx) => {
  if (!ctx.state.isAdmin) return ctx.reply('Bu buyruq faqat adminlar uchun.');
  const usersCount = await dbGet(`SELECT COUNT(*) as count FROM users`);
  const ordersCount = await dbGet(`SELECT COUNT(*) as count FROM orders`);
  const pendingPayments = await dbGet(`SELECT COUNT(*) as count FROM orders WHERE status = ?`, [STATUS.PENDING_VERIFY]);
  const totalSum = await dbGet(`SELECT SUM(amount) as sum FROM orders WHERE status = ?`, [STATUS.COMPLETED]);

  const text =
    `📊 Bot statistikasi:\n\n` +
    `👥 Foydalanuvchilar: ${usersCount?.count || 0}\n` +
    `📦 Jami buyurtmalar: ${ordersCount?.count || 0}\n` +
    `💰 Tekshiruvdagi to‘lovlar: ${pendingPayments?.count || 0}\n` +
    `💵 Jami tushum: ${formatPrice(totalSum?.sum || 0)}`;

  await ctx.reply(text);
});

// ==================================================
// SIMPLE MENU
// ==================================================
bot.hears('❌ Bekor qilish', async (ctx) => {
  resetSession(ctx);
  await ctx.reply('Amal bekor qilindi.', Keyboards.mainMenu(ctx.state.isAdmin));
});

bot.hears('🔙 Orqaga', async (ctx) => {
  resetSession(ctx);
  await ctx.reply('Orqaga qaytildi.', Keyboards.mainMenu(ctx.state.isAdmin));
});

bot.hears('🏠 Bosh menyu', async (ctx) => {
  resetSession(ctx);
  const welcomeText = await getSetting('welcome_text');
  await ctx.reply(welcomeText, Keyboards.mainMenu(ctx.state.isAdmin));
});

// ==================================================
// USER FLOW: XIZMATLAR
// ==================================================
bot.hears('🛍 Xizmatlar', async (ctx) => {
  const categories = await dbAll(`SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC`);
  if (!categories.length) return ctx.reply('Hozircha xizmatlar mavjud emas.');

  const buttons = categories.map((c) => [Markup.button.callback(c.name, `cat_${c.id}`)]);
  await ctx.reply('Kategoriyani tanlang:', Markup.inlineKeyboard(buttons));
});

bot.action(/^cat_(\d+)$/, async (ctx) => {
  const catId = Number(ctx.match[1]);
  const services = await dbAll(
    `SELECT * FROM services WHERE category_id = ? AND is_active = 1 ORDER BY sort_order ASC`,
    [catId]
  );

  if (!services.length) {
    await safeAnswerCb(ctx, 'Bu kategoriyada xizmatlar topilmadi.');
    return;
  }

  const buttons = services.map((s) => [Markup.button.callback(s.title, `srv_${s.id}`)]);
  buttons.push([Markup.button.callback('🔙 Orqaga', 'back_to_cats')]);

  await safeEditOrReply(ctx, 'Xizmatni tanlang:', Markup.inlineKeyboard(buttons));
});

bot.action('back_to_cats', async (ctx) => {
  const categories = await dbAll(`SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order ASC`);
  const buttons = categories.map((c) => [Markup.button.callback(c.name, `cat_${c.id}`)]);
  await safeEditOrReply(ctx, 'Kategoriyani tanlang:', Markup.inlineKeyboard(buttons));
});

bot.action(/^srv_(\d+)$/, async (ctx) => {
  const srvId = Number(ctx.match[1]);
  const srv = await dbGet(`SELECT * FROM services WHERE id = ? AND is_active = 1`, [srvId]);
  if (!srv) return safeAnswerCb(ctx, 'Xizmat topilmadi.');

  let text = `📦 ${srv.title}\n\n`;
  text += `${srv.short_desc || ''}\n\n`;
  text += `💰 Narxi: ${formatPrice(srv.price)}\n`;
  if (srv.old_price) text += `❌ Eski narx: ${formatPrice(srv.old_price)}\n`;
  text += `⏱ Muddat: ${srv.est_time || 'Belgilanmagan'}\n\n`;
  text += `📝 Tavsif: ${srv.full_desc || '—'}\n\n`;
  if (srv.notes) text += `💡 Izoh: ${srv.notes}`;

  const buttons = [
    [Markup.button.callback('🛒 Buyurtma berish', `order_srv_${srvId}`)],
    [Markup.button.callback('🔙 Orqaga', `cat_${srv.category_id}`)],
  ];

  await safeEditOrReply(ctx, text, Markup.inlineKeyboard(buttons));
});

bot.action(/^order_srv_(\d+)$/, async (ctx) => {
  const srvId = Number(ctx.match[1]);
  const srv = await dbGet(`SELECT * FROM services WHERE id = ? AND is_active = 1`, [srvId]);
  if (!srv) return safeAnswerCb(ctx, 'Xizmat topilmadi.');

  let fields = [];
  try {
    fields = JSON.parse(srv.required_fields || '[]');
    if (!Array.isArray(fields)) fields = [];
  } catch (_) {
    fields = [];
  }

  ctx.session = {
    flow: 'order_service',
    step: 0,
    type: 'service',
    itemId: srv.id,
    itemTitle: srv.title,
    amount: srv.price,
    fields,
    answers: {},
  };

  if (!fields.length) {
    return finalizeOrder(ctx, {
      type: 'service',
      itemId: srv.id,
      title: srv.title,
      amount: srv.price,
      answers: {},
    });
  }

  const currentField = fields[0];
  return ctx.reply(
    `${currentField.label}ni kiriting:\n\nNamuna: ${currentField.example || '—'}`,
    Keyboards.cancel()
  );
});

// ==================================================
// USER FLOW: PREMIUM
// ==================================================
bot.hears('💎 Telegram Premium', async (ctx) => {
  const packages = await dbAll(`SELECT * FROM premium_packages WHERE is_active = 1 ORDER BY sort_order ASC`);
  if (!packages.length) return ctx.reply('Hozircha Premium paketlar mavjud emas.');

  let text = '💎 Telegram Premium\n\n';
  text += '✅ Akkauntga kirish talab qilinmaydi\n';
  text += '✅ Parol kerak emas\n';
  text += '✅ Rasmiy gift tarzida yuboriladi\n\n';
  text += 'Paketni tanlang:';

  const buttons = packages.map((p) => [Markup.button.callback(`${p.title} - ${formatPrice(p.price)}`, `prem_${p.id}`)]);
  await ctx.reply(text, Markup.inlineKeyboard(buttons));
});

bot.action(/^prem_(\d+)$/, async (ctx) => {
  const pkgId = Number(ctx.match[1]);
  const pkg = await dbGet(`SELECT * FROM premium_packages WHERE id = ? AND is_active = 1`, [pkgId]);
  if (!pkg) return safeAnswerCb(ctx, 'Paket topilmadi.');

  ctx.session = {
    flow: 'order_premium',
    step: 'target',
    type: 'premium',
    itemId: pkg.id,
    itemTitle: pkg.title,
    amount: pkg.price,
  };

  await ctx.reply(
    "Premium yuborilishi kerak bo‘lgan foydalanuvchi ma’lumotini yuboring:\n\nNamuna:\n@username\nhttps://t.me/username\n123456789",
    Keyboards.cancel()
  );
});

// ==================================================
// USER FLOW: STARS
// ==================================================
bot.hears('⭐ Telegram Stars', async (ctx) => {
  const packages = await dbAll(`SELECT * FROM stars_packages WHERE is_active = 1 ORDER BY sort_order ASC`);
  if (!packages.length) return ctx.reply('Hozircha Stars paketlar mavjud emas.');

  let text = '⭐ Telegram Stars\n\n';
  text += "Stars orqali Telegram ichidagi ayrim raqamli xizmatlar uchun foydalanish mumkin.\n\n";
  text += 'Paketni tanlang:';

  const buttons = packages.map((p) => [Markup.button.callback(`${p.title} - ${formatPrice(p.price)}`, `stars_${p.id}`)]);
  await ctx.reply(text, Markup.inlineKeyboard(buttons));
});

bot.action(/^stars_(\d+)$/, async (ctx) => {
  const pkgId = Number(ctx.match[1]);
  const pkg = await dbGet(`SELECT * FROM stars_packages WHERE id = ? AND is_active = 1`, [pkgId]);
  if (!pkg) return safeAnswerCb(ctx, 'Paket topilmadi.');

  ctx.session = {
    flow: 'order_stars',
    step: 'target',
    type: 'stars',
    itemId: pkg.id,
    itemTitle: pkg.title,
    amount: pkg.price,
  };

  await ctx.reply(
    "Stars yuborilishi kerak bo‘lgan foydalanuvchi ma’lumotini yuboring:\n\nNamuna:\n@username\nhttps://t.me/username\n123456789",
    Keyboards.cancel()
  );
});

// ==================================================
// ORDER FINALIZE + CONFIRM
// ==================================================
async function finalizeOrder(ctx, payload) {
  ctx.session = {
    ...ctx.session,
    flow: 'confirm_order_final',
    pendingOrder: payload,
  };

  let summary = `📋 Buyurtma tafsilotlari:\n\n`;
  summary += `📦 Xizmat: ${payload.title}\n`;

  if (payload.type === 'service' && payload.answers) {
    Object.entries(payload.answers).forEach(([k, v]) => {
      summary += `• ${k}: ${v}\n`;
    });
  }

  if ((payload.type === 'premium' || payload.type === 'stars') && payload.target) {
    summary += `👤 Qabul qiluvchi: ${payload.target}\n`;
  }

  summary += `💰 Narxi: ${formatPrice(payload.amount)}\n\n`;
  summary += `Tasdiqlaysizmi?`;

  const buttons = [
    [Markup.button.callback('✅ Tasdiqlash', 'confirm_order')],
    [Markup.button.callback('❌ Bekor qilish', 'cancel_order')],
  ];

  await ctx.reply(summary, Markup.inlineKeyboard(buttons));
}

bot.action('confirm_order', async (ctx) => {
  if (!ctx.session || !ctx.session.pendingOrder) {
    await safeAnswerCb(ctx, 'Bu tugma eskirgan.');
    return safeEditOrReply(ctx, 'Bu tugma eskirgan. Iltimos, qayta urinib ko‘ring.');
  }

  const pending = ctx.session.pendingOrder;
  const userId = ctx.state.user.id;
  const prefix = (await getSetting('order_prefix')) || 'ORD';
  const orderIdStr = `${prefix}-${Date.now().toString().slice(-6)}`;

  const data =
    pending.type === 'service'
      ? JSON.stringify(pending.answers || {})
      : JSON.stringify({ target: pending.target || '' });

  await dbRun(
    `INSERT INTO orders (order_id_str, user_id, service_type, service_id, amount, status, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [orderIdStr, userId, pending.type, pending.itemId, pending.amount, STATUS.PENDING_PAYMENT, data]
  );

  await dbRun(`UPDATE users SET order_count = order_count + 1 WHERE id = ?`, [userId]);

  await logAction('order_created', {
    orderIdStr,
    userId,
    type: pending.type,
    service_id: pending.itemId,
    amount: pending.amount,
  });

  resetSession(ctx);

  let text = `✅ Buyurtma qabul qilindi!\n\n`;
  text += `🆔 Buyurtma ID: #${orderIdStr}\n`;
  text += `💰 To‘lov miqdori: ${formatPrice(pending.amount)}\n\n`;
  text += `Iltimos, endi to‘lovni amalga oshiring va chekni yuboring.`;

  const buttons = [
    [Markup.button.callback('💳 To‘lov qilish', `pay_${orderIdStr}`)],
    [Markup.button.callback('📦 Buyurtmalarim', 'my_orders')],
  ];

  await safeEditOrReply(ctx, text, Markup.inlineKeyboard(buttons));

  await notifyAdmins(
    `🆕 Yangi buyurtma!\n\n` +
      `ID: #${orderIdStr}\n` +
      `Mijoz: ${ctx.from.first_name || 'Noma’lum'}${ctx.from.username ? ` (@${ctx.from.username})` : ''}\n` +
      `Xizmat: ${pending.title}\n` +
      `Summa: ${formatPrice(pending.amount)}`
  );
});

bot.action('cancel_order', async (ctx) => {
  resetSession(ctx);
  await safeEditOrReply(ctx, 'Buyurtma bekor qilindi.');
});

// ==================================================
// TEXT STATE MACHINE
// ==================================================
bot.on('text', async (ctx, next) => {
  if (!ctx.session || !ctx.session.flow) return next();

  const text = String(ctx.message.text || '').trim();
  if (!text) return next();
  if (text === '❌ Bekor qilish' || text === '🔙 Orqaga') return next();

  // Service order flow
  if (ctx.session.flow === 'order_service') {
    const currentField = ctx.session.fields[ctx.session.step];
    if (!currentField) {
      resetSession(ctx);
      return ctx.reply('Jarayon yangilanib ketdi. Iltimos, qayta urinib ko‘ring.', Keyboards.mainMenu(ctx.state.isAdmin));
    }

    const validation = validateField(currentField, text);
    if (!validation.ok) return ctx.reply(validation.msg);

    ctx.session.answers[currentField.key] = text;
    ctx.session.step += 1;

    if (ctx.session.step < ctx.session.fields.length) {
      const nextField = ctx.session.fields[ctx.session.step];
      return ctx.reply(
        `${nextField.label}ni kiriting:\n\nNamuna: ${nextField.example || '—'}`,
        Keyboards.cancel()
      );
    }

    return finalizeOrder(ctx, {
      type: 'service',
      itemId: ctx.session.itemId,
      title: ctx.session.itemTitle,
      amount: ctx.session.amount,
      answers: ctx.session.answers,
    });
  }

  if (ctx.session.flow === 'order_premium' || ctx.session.flow === 'order_stars') {
    if (ctx.session.step === 'target') {
      if (!validateTelegramTarget(text)) {
        return ctx.reply(
          "Xato format. Quyidagilardan birini yuboring:\n@username\nhttps://t.me/username\n123456789"
        );
      }

      return finalizeOrder(ctx, {
        type: ctx.session.type,
        itemId: ctx.session.itemId,
        title: ctx.session.itemTitle,
        amount: ctx.session.amount,
        target: text,
      });
    }
  }

  // Support flow
  if (ctx.session.flow === 'support_message') {
    await dbRun(`INSERT INTO support_messages (user_id, message_text, status) VALUES (?, ?, ?)`, [
      ctx.state.user.id,
      text,
      SUPPORT_STATUS.OPEN,
    ]);

    await logAction('support_created', {
      user_id: ctx.state.user.id,
      telegram_id: ctx.from.id,
    });

    resetSession(ctx);
    await ctx.reply('Xabaringiz adminga yuborildi. Tez orada javob qaytaramiz.', Keyboards.mainMenu(ctx.state.isAdmin));

    for (const adminId of ADMIN_IDS) {
      try {
        await bot.telegram.sendMessage(
          adminId,
          `📩 Yangi murojaat!\n\nKimdan: ${ctx.from.first_name || 'Noma’lum'}${ctx.from.username ? ` (@${ctx.from.username})` : ''}\nID: ${ctx.from.id}\n\nXabar:\n${text}`
        );
      } catch (_) {}
    }
    return;
  }

  // Admin reply to support
  if (ctx.session.flow === 'admin_reply_support' && ctx.state.isAdmin) {
    const supportId = ctx.session.supportId;
    const support = await dbGet(`SELECT * FROM support_messages WHERE id = ?`, [supportId]);
    if (!support) {
      resetSession(ctx);
      return ctx.reply('Murojaat topilmadi.', Keyboards.adminMenu());
    }

    const user = await dbGet(`SELECT telegram_id FROM users WHERE id = ?`, [support.user_id]);
    if (user) {
      try {
        await bot.telegram.sendMessage(
          user.telegram_id,
          `📩 Admin javobi:\n\n${text}`
        );
      } catch (_) {}
    }

    await dbRun(`UPDATE support_messages SET admin_reply = ?, status = ? WHERE id = ?`, [
      text,
      SUPPORT_STATUS.CLOSED,
      supportId,
    ]);

    await logAction('support_replied', {
      support_id: supportId,
      admin_id: ctx.from.id,
    });

    resetSession(ctx);
    return ctx.reply('Javob foydalanuvchiga yuborildi.', Keyboards.adminMenu());
  }

  // Admin reject payment reason
  if (ctx.session.flow === 'admin_reject_payment_reason' && ctx.state.isAdmin) {
    const orderId = ctx.session.orderId;
    const order = await dbGet(`SELECT * FROM orders WHERE id = ?`, [orderId]);
    if (!order) {
      resetSession(ctx);
      return ctx.reply('Buyurtma topilmadi.', Keyboards.adminMenu());
    }

    await dbRun(`UPDATE orders SET status = ?, admin_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
      STATUS.PENDING_PAYMENT,
      text,
      orderId,
    ]);
    await dbRun(
      `UPDATE payments SET status = ?, admin_reason = ? WHERE order_id = ? AND status = ?`,
      [PAYMENT_STATUS.REJECTED, text, orderId, PAYMENT_STATUS.PENDING]
    );

    const u = await dbGet(`SELECT telegram_id FROM users WHERE id = ?`, [order.user_id]);
    if (u) {
      try {
        await bot.telegram.sendMessage(
          u.telegram_id,
          `❌ Buyurtmangiz (#${order.order_id_str}) bo‘yicha to‘lov rad etildi.\n\nSabab: ${text}\n\nIltimos, to‘lovni qayta tekshirib, chekni qayta yuboring.`
        );
      } catch (_) {}
    }

    await logAction('payment_rejected', {
      order_id: orderId,
      reason: text,
      admin_id: ctx.from.id,
    });

    resetSession(ctx);
    return ctx.reply('To‘lov rad etildi va foydalanuvchiga xabar yuborildi.', Keyboards.adminMenu());
  }

  // Admin cancel order reason
  if (ctx.session.flow === 'admin_cancel_order_reason' && ctx.state.isAdmin) {
    const orderId = ctx.session.orderId;
    const order = await dbGet(`SELECT * FROM orders WHERE id = ?`, [orderId]);
    if (!order) {
      resetSession(ctx);
      return ctx.reply('Buyurtma topilmadi.', Keyboards.adminMenu());
    }

    await dbRun(`UPDATE orders SET status = ?, admin_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
      STATUS.CANCELED,
      text,
      orderId,
    ]);

    const u = await dbGet(`SELECT telegram_id FROM users WHERE id = ?`, [order.user_id]);
    if (u) {
      try {
        await bot.telegram.sendMessage(
          u.telegram_id,
          `🛑 Buyurtmangiz (#${order.order_id_str}) bekor qilindi.\n\nSabab: ${text}`
        );
      } catch (_) {}
    }

    await logAction('order_canceled', {
      order_id: orderId,
      reason: text,
      admin_id: ctx.from.id,
    });

    resetSession(ctx);
    return ctx.reply('Buyurtma bekor qilindi.', Keyboards.adminMenu());
  }

  // Admin add comment
  if (ctx.session.flow === 'admin_add_comment' && ctx.state.isAdmin) {
    const orderId = ctx.session.orderId;
    const order = await dbGet(`SELECT * FROM orders WHERE id = ?`, [orderId]);
    if (!order) {
      resetSession(ctx);
      return ctx.reply('Buyurtma topilmadi.', Keyboards.adminMenu());
    }

    await dbRun(`UPDATE orders SET admin_comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [text, orderId]);
    await logAction('order_comment_added', {
      order_id: orderId,
      admin_id: ctx.from.id,
    });

    resetSession(ctx);
    return ctx.reply('Admin izohi saqlandi.', Keyboards.adminMenu());
  }

  // Admin message to user
  if (ctx.session.flow === 'admin_message_user' && ctx.state.isAdmin) {
    const orderId = ctx.session.orderId;
    const order = await dbGet(`SELECT * FROM orders WHERE id = ?`, [orderId]);
    if (!order) {
      resetSession(ctx);
      return ctx.reply('Buyurtma topilmadi.', Keyboards.adminMenu());
    }

    const u = await dbGet(`SELECT telegram_id FROM users WHERE id = ?`, [order.user_id]);
    if (!u) {
      resetSession(ctx);
      return ctx.reply('Foydalanuvchi topilmadi.', Keyboards.adminMenu());
    }

    try {
      await bot.telegram.sendMessage(u.telegram_id, `📩 Admin xabari:\n\n${text}`);
      await logAction('admin_message_sent', {
        order_id: orderId,
        admin_id: ctx.from.id,
      });
      resetSession(ctx);
      return ctx.reply('Xabar foydalanuvchiga yuborildi.', Keyboards.adminMenu());
    } catch (e) {
      resetSession(ctx);
      return ctx.reply('Xabar yuborilmadi.', Keyboards.adminMenu());
    }
  }

  return next();
});

// ==================================================
// BUYURTMALARIM
// ==================================================
bot.hears('📦 Buyurtmalarim', async (ctx) => {
  const orders = await dbAll(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [ctx.state.user.id]);
  if (!orders.length) return ctx.reply('Sizda hali buyurtmalar mavjud emas.');

  let text = '📦 Sizning buyurtmalaringiz:\n\n';
  const buttons = [];

  for (const o of orders) {
    text += `#${o.order_id_str} | ${o.status} | ${formatPrice(o.amount)}\n`;
    buttons.push([Markup.button.callback(`#${o.order_id_str} tafsilotlari`, `view_order_${o.id}`)]);
  }

  await ctx.reply(text, Markup.inlineKeyboard(buttons));
});

bot.action(/^view_order_(\d+)$/, async (ctx) => {
  const id = Number(ctx.match[1]);
  const o = await dbGet(`SELECT * FROM orders WHERE id = ? AND user_id = ?`, [id, ctx.state.user.id]);

  if (!o) {
    await safeAnswerCb(ctx, 'Buyurtma topilmadi.');
    return;
  }

  const serviceName = await getOrderDisplayName(o);
  let text = `🆔 Buyurtma ID: #${o.order_id_str}\n`;
  text += `📦 Xizmat: ${serviceName}\n`;
  text += `📊 Holati: ${o.status}\n`;
  text += `💰 Summa: ${formatPrice(o.amount)}\n`;
  text += `📅 Sana: ${o.created_at}\n\n`;
  text += `📝 Ma’lumotlar:\n${prettyJsonData(o.data)}\n\n`;

  if (o.admin_comment) text += `💬 Admin izohi: ${o.admin_comment}\n\n`;

  const buttons = [];
  if (o.status === STATUS.PENDING_PAYMENT) {
    buttons.push([Markup.button.callback('💳 To‘lov qilish', `pay_${o.order_id_str}`)]);
  }
  buttons.push([Markup.button.callback('📩 Yordam kerak', 'contact_support')]);
  buttons.push([Markup.button.callback('🔙 Orqaga', 'my_orders')]);

  await safeEditOrReply(ctx, text, Markup.inlineKeyboard(buttons));
});

bot.action('my_orders', async (ctx) => {
  const orders = await dbAll(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10`, [ctx.state.user.id]);
  if (!orders.length) return safeEditOrReply(ctx, 'Sizda hali buyurtmalar mavjud emas.');

  let text = '📦 Sizning buyurtmalaringiz:\n\n';
  const buttons = [];

  for (const o of orders) {
    text += `#${o.order_id_str} | ${o.status} | ${formatPrice(o.amount)}\n`;
    buttons.push([Markup.button.callback(`#${o.order_id_str} tafsilotlari`, `view_order_${o.id}`)]);
  }

  await safeEditOrReply(ctx, text, Markup.inlineKeyboard(buttons));
});

// ==================================================
// TO‘LOV
// ==================================================
bot.hears('💳 To‘lov qilish', async (ctx) => {
  const pendingOrders = await dbAll(`SELECT * FROM orders WHERE user_id = ? AND status = ?`, [
    ctx.state.user.id,
    STATUS.PENDING_PAYMENT,
  ]);

  if (!pendingOrders.length) return ctx.reply("Sizda to‘lov kutilayotgan buyurtmalar yo‘q.");

  const buttons = pendingOrders.map((o) => [
    Markup.button.callback(`#${o.order_id_str} - ${formatPrice(o.amount)}`, `pay_${o.order_id_str}`),
  ]);

  await ctx.reply("To‘lov qilmoqchi bo‘lgan buyurtmani tanlang:", Markup.inlineKeyboard(buttons));
});

bot.action(/^pay_(.+)$/, async (ctx) => {
  const orderIdStr = ctx.match[1];
  const order = await dbGet(`SELECT * FROM orders WHERE order_id_str = ?`, [orderIdStr]);
  if (!order) return safeAnswerCb(ctx, 'Buyurtma topilmadi.');

  const methods = await dbAll(`SELECT * FROM payment_methods WHERE is_active = 1 ORDER BY sort_order ASC`);
  if (!methods.length) return safeEditOrReply(ctx, 'Hozircha to‘lov usullari mavjud emas. Admin bilan bog‘laning.');

  ctx.session = {
    flow: 'select_payment_method',
    orderIdStr,
  };

  const buttons = methods.map((m) => [Markup.button.callback(m.title, `pay_method_${m.id}`)]);
  await safeEditOrReply(ctx, "To‘lov usulini tanlang:", Markup.inlineKeyboard(buttons));
});

bot.action(/^pay_method_(\d+)$/, async (ctx) => {
  const methodId = Number(ctx.match[1]);
  const method = await dbGet(`SELECT * FROM payment_methods WHERE id = ? AND is_active = 1`, [methodId]);
  if (!method) return safeAnswerCb(ctx, 'To‘lov usuli topilmadi.');

  const orderIdStr = ctx.session?.orderIdStr;
  const order = await dbGet(`SELECT * FROM orders WHERE order_id_str = ?`, [orderIdStr]);
  if (!order) return safeEditOrReply(ctx, 'Buyurtma topilmadi. Iltimos, qayta urinib ko‘ring.');

  ctx.session = {
    flow: 'upload_receipt',
    methodId,
    orderId: order.id,
  };

  let text = `💳 ${method.title} orqali to‘lov\n\n`;
  text += `💰 To‘lov miqdori: ${formatPrice(order.amount)}\n\n`;
  text += `Rekvizitlar:\n${method.account_details}\n`;
  text += `Ega: ${method.holder_name}\n\n`;
  text += `📝 Ko‘rsatma: ${method.instruction}\n\n`;
  text += `To‘lovni amalga oshirgach, chekni rasm yoki hujjat ko‘rinishida yuboring.`;

  // editMessageText bilan reply keyboard ishlamaydi, shuning uchun alohida reply yuboramiz
  try {
    await ctx.editMessageText(text);
  } catch (_) {
    await ctx.reply(text);
  }
  await ctx.reply('Chekni yuboring:', Keyboards.cancel());
});

bot.on(['photo', 'document'], async (ctx, next) => {
  if (!ctx.session || ctx.session.flow !== 'upload_receipt') return next();

  const orderId = ctx.session.orderId;
  const methodId = ctx.session.methodId;

  if (!orderId || !methodId) {
    resetSession(ctx);
    return ctx.reply('Jarayon yangilanib ketdi. Iltimos, qayta urinib ko‘ring.', Keyboards.mainMenu(ctx.state.isAdmin));
  }

  const existingRecent = await dbGet(
    `SELECT * FROM payments WHERE order_id = ? AND user_id = ? AND status = ? ORDER BY submitted_at DESC LIMIT 1`,
    [orderId, ctx.state.user.id, PAYMENT_STATUS.PENDING]
  );

  if (existingRecent) {
    resetSession(ctx);
    return ctx.reply('Bu buyurtma uchun to‘lov cheki allaqachon yuborilgan va tekshirilmoqda.', Keyboards.mainMenu(ctx.state.isAdmin));
  }

  const fileId = ctx.message.photo
    ? ctx.message.photo[ctx.message.photo.length - 1].file_id
    : ctx.message.document.file_id;
  const proofType = ctx.message.photo ? 'photo' : 'document';

  await dbRun(
    `INSERT INTO payments (order_id, user_id, method_id, proof_type, proof_value, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [orderId, ctx.state.user.id, methodId, proofType, fileId, PAYMENT_STATUS.PENDING]
  );

  await dbRun(`UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
    STATUS.PENDING_VERIFY,
    orderId,
  ]);

  const order = await dbGet(`SELECT * FROM orders WHERE id = ?`, [orderId]);
  await logAction('payment_submitted', {
    order_id: orderId,
    user_id: ctx.state.user.id,
    method_id: methodId,
  });

  resetSession(ctx);

  await ctx.reply(
    '✅ To‘lov cheki qabul qilindi! Admin tez orada tekshirib buyurtmani tasdiqlaydi.',
    Keyboards.mainMenu(ctx.state.isAdmin)
  );

  for (const adminId of ADMIN_IDS) {
    try {
      await bot.telegram.sendMessage(
        adminId,
        `💰 Yangi to‘lov cheki!\n\nBuyurtma: #${order.order_id_str}\nMijoz: ${ctx.from.first_name || 'Noma’lum'}\nSumma: ${formatPrice(order.amount)}`
      );
      if (proofType === 'photo') await bot.telegram.sendPhoto(adminId, fileId);
      else await bot.telegram.sendDocument(adminId, fileId);
    } catch (_) {}
  }
});

// ==================================================
// SUPPORT / RULES / FAQ
// ==================================================
bot.hears('📩 Bog‘lanish', async (ctx) => {
  const supportText = await getSetting('support_text');
  const supportUser = await getSetting('support_username');
  const workingHours = await getSetting('working_hours');

  let text = `📩 Bog‘lanish\n\n${supportText}\n\n`;
  text += `⏰ Ish vaqti: ${workingHours}\n`;
  text += `👤 Admin: ${supportUser}`;

  const buttons = [[Markup.button.callback('✉️ Xabar yuborish', 'contact_support')]];
  await ctx.reply(text, Markup.inlineKeyboard(buttons));
});

bot.action('contact_support', async (ctx) => {
  ctx.session = { flow: 'support_message' };
  await ctx.reply('Xabaringizni yozing:', Keyboards.cancel());
});

bot.hears('ℹ️ Qoidalar', async (ctx) => {
  const rules = await getSetting('rules_text');
  await ctx.reply(`ℹ️ Botdan foydalanish qoidalari:\n\n${rules}`);
});

bot.hears('❓ Yordam', async (ctx) => {
  const faq = await getSetting('faq_text');
  await ctx.reply(`❓ Ko‘p beriladigan savollar:\n\n${faq}`);
});

// ==================================================
// ADMIN PANEL
// ==================================================
bot.hears('⚙️ Admin panel', async (ctx) => {
  if (!ctx.state.isAdmin) return;
  await ctx.reply('Admin panelga xush kelibsiz:', Keyboards.adminMenu());
});

bot.hears('📊 Statistika', async (ctx) => {
  if (!ctx.state.isAdmin) return;

  const usersCount = await dbGet(`SELECT COUNT(*) as count FROM users`);
  const ordersCount = await dbGet(`SELECT COUNT(*) as count FROM orders`);
  const pendingPayments = await dbGet(`SELECT COUNT(*) as count FROM orders WHERE status = ?`, [STATUS.PENDING_VERIFY]);
  const totalSum = await dbGet(`SELECT SUM(amount) as sum FROM orders WHERE status = ?`, [STATUS.COMPLETED]);

  let text = '📊 Bot statistikasi:\n\n';
  text += `👥 Foydalanuvchilar: ${usersCount?.count || 0}\n`;
  text += `📦 Jami buyurtmalar: ${ordersCount?.count || 0}\n`;
  text += `💰 Kutilayotgan to‘lovlar: ${pendingPayments?.count || 0}\n`;
  text += `💵 Jami tushum: ${formatPrice(totalSum?.sum || 0)}`;

  await ctx.reply(text);
});

bot.hears('📦 Buyurtmalar', async (ctx) => {
  if (!ctx.state.isAdmin) return;

  const orders = await dbAll(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 15`);
  if (!orders.length) return ctx.reply('Buyurtmalar mavjud emas.');

  const buttons = orders.map((o) => [Markup.button.callback(`#${o.order_id_str} | ${o.status}`, `admin_view_order_${o.id}`)]);
  await ctx.reply("So‘nggi buyurtmalar:", Markup.inlineKeyboard(buttons));
});

bot.action('admin_orders', async (ctx) => {
  if (!ctx.state.isAdmin) return;
  const orders = await dbAll(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 15`);
  if (!orders.length) return safeEditOrReply(ctx, 'Buyurtmalar mavjud emas.');
  const buttons = orders.map((o) => [Markup.button.callback(`#${o.order_id_str} | ${o.status}`, `admin_view_order_${o.id}`)]);
  await safeEditOrReply(ctx, "So‘nggi buyurtmalar:", Markup.inlineKeyboard(buttons));
});

bot.action(/^admin_view_order_(\d+)$/, async (ctx) => {
  if (!ctx.state.isAdmin) return;

  const id = Number(ctx.match[1]);
  const o = await dbGet(
    `SELECT o.*, u.first_name, u.last_name, u.username, u.telegram_id
     FROM orders o
     JOIN users u ON o.user_id = u.id
     WHERE o.id = ?`,
    [id]
  );

  if (!o) return safeAnswerCb(ctx, 'Buyurtma topilmadi.');

  const serviceName = await getOrderDisplayName(o);
  let text = `🆔 ID: #${o.order_id_str}\n`;
  text += `👤 Mijoz: ${o.first_name || ''} ${o.last_name || ''}${o.username ? ` (@${o.username})` : ''} [${o.telegram_id}]\n`;
  text += `📦 Xizmat: ${serviceName}\n`;
  text += `💰 Summa: ${formatPrice(o.amount)}\n`;
  text += `📊 Holat: ${o.status}\n`;
  text += `📝 Ma’lumotlar:\n${prettyJsonData(o.data)}\n`;
  if (o.admin_comment) text += `\n💬 Admin izohi: ${o.admin_comment}\n`;

  const buttons = [
    [Markup.button.callback("✅ To‘lovni tasdiqlash", `admin_approve_pay_${o.id}`)],
    [Markup.button.callback("❌ To‘lovni rad etish", `admin_reject_pay_${o.id}`)],
    [Markup.button.callback('🚀 Ishni boshlash', `admin_start_work_${o.id}`)],
    [Markup.button.callback('🏁 Bajarildi', `admin_complete_${o.id}`)],
    [Markup.button.callback('🛑 Bekor qilish', `admin_cancel_${o.id}`)],
    [Markup.button.callback("💬 Izoh qo‘shish", `admin_comment_${o.id}`)],
    [Markup.button.callback("📩 Mijozga yozish", `admin_msg_${o.id}`)],
    [Markup.button.callback('🔙 Orqaga', 'admin_orders')],
  ];

  await safeEditOrReply(ctx, text, Markup.inlineKeyboard(buttons));
});

bot.action(/^admin_approve_pay_(\d+)$/, async (ctx) => {
  if (!ctx.state.isAdmin) return;

  const id = Number(ctx.match[1]);
  const o = await dbGet(`SELECT * FROM orders WHERE id = ?`, [id]);
  if (!o) return safeAnswerCb(ctx, 'Buyurtma topilmadi.');

  const u = await dbGet(`SELECT telegram_id FROM users WHERE id = ?`, [o.user_id]);
  await dbRun(`UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [STATUS.CONFIRMED, id]);
  await dbRun(`UPDATE payments SET status = ? WHERE order_id = ? AND status = ?`, [
    PAYMENT_STATUS.APPROVED,
    id,
    PAYMENT_STATUS.PENDING,
  ]);

  await logAction('payment_approved', { order_id: id, admin_id: ctx.from.id });
  await safeAnswerCb(ctx, "To‘lov tasdiqlandi.");

  if (u) {
    try {
      await bot.telegram.sendMessage(
        u.telegram_id,
        `✅ Buyurtmangiz (#${o.order_id_str}) uchun to‘lov tasdiqlandi! Tez orada ish boshlanadi.`
      );
    } catch (_) {}
  }

  await safeEditOrReply(ctx, `Buyurtma #${o.order_id_str} to‘lovi tasdiqlandi.`);
});

bot.action(/^admin_reject_pay_(\d+)$/, async (ctx) => {
  if (!ctx.state.isAdmin) return;
  const id = Number(ctx.match[1]);
  const o = await dbGet(`SELECT * FROM orders WHERE id = ?`, [id]);
  if (!o) return safeAnswerCb(ctx, 'Buyurtma topilmadi.');

  ctx.session = { flow: 'admin_reject_payment_reason', orderId: id };
  await ctx.reply("To‘lovni rad etish sababini yozing:", Keyboards.cancel());
});

bot.action(/^admin_start_work_(\d+)$/, async (ctx) => {
  if (!ctx.state.isAdmin) return;

  const id = Number(ctx.match[1]);
  const o = await dbGet(`SELECT * FROM orders WHERE id = ?`, [id]);
  if (!o) return safeAnswerCb(ctx, 'Buyurtma topilmadi.');

  const u = await dbGet(`SELECT telegram_id FROM users WHERE id = ?`, [o.user_id]);

  await dbRun(`UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [STATUS.PROCESSING, id]);
  await logAction('order_processing', { order_id: id, admin_id: ctx.from.id });
  await safeAnswerCb(ctx, 'Ish boshlandi.');

  if (u) {
    try {
      await bot.telegram.sendMessage(
        u.telegram_id,
        `🚀 Buyurtmangiz (#${o.order_id_str}) bo‘yicha ish boshlandi.`
      );
    } catch (_) {}
  }

  await safeEditOrReply(ctx, `Buyurtma #${o.order_id_str} uchun ish boshlandi.`);
});

bot.action(/^admin_complete_(\d+)$/, async (ctx) => {
  if (!ctx.state.isAdmin) return;

  const id = Number(ctx.match[1]);
  const o = await dbGet(`SELECT * FROM orders WHERE id = ?`, [id]);
  if (!o) return safeAnswerCb(ctx, 'Buyurtma topilmadi.');

  const u = await dbGet(`SELECT telegram_id FROM users WHERE id = ?`, [o.user_id]);

  await dbRun(`UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [STATUS.COMPLETED, id]);
  await logAction('order_completed', { order_id: id, admin_id: ctx.from.id });
  await safeAnswerCb(ctx, 'Buyurtma bajarildi.');

  if (u) {
    try {
      await bot.telegram.sendMessage(
        u.telegram_id,
        `🏁 Buyurtmangiz (#${o.order_id_str}) muvaffaqiyatli bajarildi! Bizni tanlaganingiz uchun rahmat.`
      );
    } catch (_) {}
  }

  await safeEditOrReply(ctx, `Buyurtma #${o.order_id_str} bajarildi deb belgilandi.`);
});

bot.action(/^admin_cancel_(\d+)$/, async (ctx) => {
  if (!ctx.state.isAdmin) return;
  const id = Number(ctx.match[1]);
  const o = await dbGet(`SELECT * FROM orders WHERE id = ?`, [id]);
  if (!o) return safeAnswerCb(ctx, 'Buyurtma topilmadi.');

  ctx.session = { flow: 'admin_cancel_order_reason', orderId: id };
  await ctx.reply("Buyurtmani bekor qilish sababini yozing:", Keyboards.cancel());
});

bot.action(/^admin_comment_(\d+)$/, async (ctx) => {
  if (!ctx.state.isAdmin) return;
  const id = Number(ctx.match[1]);
  const o = await dbGet(`SELECT * FROM orders WHERE id = ?`, [id]);
  if (!o) return safeAnswerCb(ctx, 'Buyurtma topilmadi.');

  ctx.session = { flow: 'admin_add_comment', orderId: id };
  await ctx.reply("Admin izohini yozing:", Keyboards.cancel());
});

bot.action(/^admin_msg_(\d+)$/, async (ctx) => {
  if (!ctx.state.isAdmin) return;
  const id = Number(ctx.match[1]);
  const o = await dbGet(`SELECT * FROM orders WHERE id = ?`, [id]);
  if (!o) return safeAnswerCb(ctx, 'Buyurtma topilmadi.');

  ctx.session = { flow: 'admin_message_user', orderId: id };
  await ctx.reply("Foydalanuvchiga yuboriladigan xabarni yozing:", Keyboards.cancel());
});

bot.hears('💰 To‘lovlar', async (ctx) => {
  if (!ctx.state.isAdmin) return;

  const payments = await dbAll(
    `SELECT p.*, o.order_id_str, o.amount, u.first_name, u.username
     FROM payments p
     JOIN orders o ON p.order_id = o.id
     JOIN users u ON p.user_id = u.id
     WHERE p.status = ?
     ORDER BY p.submitted_at DESC
     LIMIT 15`,
    [PAYMENT_STATUS.PENDING]
  );

  if (!payments.length) return ctx.reply("Tekshiruv kutayotgan to‘lovlar yo‘q.");

  const buttons = payments.map((p) => [
    Markup.button.callback(`#${p.order_id_str} | ${p.first_name || 'User'}`, `admin_view_order_${p.order_id}`),
  ]);

  await ctx.reply("Tekshiruv kutayotgan to‘lovlar:", Markup.inlineKeyboard(buttons));
});

bot.hears('🛍 Xizmatlar', async (ctx, next) => {
  if (!ctx.state.isAdmin) return next();
  return ctx.reply(
    "Xizmatlar bo‘limi hozircha ko‘rish rejimida. Kerak bo‘lsa keyin CRUD ham qo‘shamiz.",
    Keyboards.adminMenu()
  );
});

bot.hears('🗂 Kategoriyalar', async (ctx) => {
  if (!ctx.state.isAdmin) return;
  const categories = await dbAll(`SELECT * FROM categories ORDER BY sort_order ASC`);
  if (!categories.length) return ctx.reply('Kategoriyalar topilmadi.', Keyboards.adminMenu());

  let text = '🗂 Kategoriyalar:\n\n';
  categories.forEach((c) => {
    text += `• ${c.name} ${c.is_active ? '✅' : '❌'}\n`;
  });
  await ctx.reply(text, Keyboards.adminMenu());
});

bot.hears('👥 Foydalanuvchilar', async (ctx) => {
  if (!ctx.state.isAdmin) return;
  const users = await dbAll(`SELECT * FROM users ORDER BY join_date DESC LIMIT 20`);

  let text = '👥 So‘nggi foydalanuvchilar:\n\n';
  users.forEach((u) => {
    text += `• ${u.first_name || ''}${u.username ? ` (@${u.username})` : ''} | ID: ${u.telegram_id}\n`;
  });

  await ctx.reply(text || 'Foydalanuvchilar topilmadi.', Keyboards.adminMenu());
});

bot.hears('📣 Xabar yuborish', async (ctx) => {
  if (!ctx.state.isAdmin) return;
  await ctx.reply(
    "Broadcast funksiyasi bu versiyada xavfsizlik uchun ommaviy yuborishsiz qoldirildi. Kerak bo‘lsa keyin alohida qo‘shamiz.",
    Keyboards.adminMenu()
  );
});

bot.hears('🧾 To‘lov usullari', async (ctx) => {
  if (!ctx.state.isAdmin) return;
  const methods = await dbAll(`SELECT * FROM payment_methods ORDER BY sort_order ASC`);
  if (!methods.length) return ctx.reply("To‘lov usullari topilmadi.", Keyboards.adminMenu());

  let text = "🧾 To‘lov usullari:\n\n";
  methods.forEach((m) => {
    text += `• ${m.title} | ${m.account_details} | ${m.holder_name}\n`;
  });

  await ctx.reply(text, Keyboards.adminMenu());
});

bot.hears('⚙️ Sozlamalar', async (ctx) => {
  if (!ctx.state.isAdmin) return;
  const settings = await dbAll(`SELECT * FROM settings ORDER BY key ASC`);

  let text = '⚙️ Sozlamalar:\n\n';
  settings.forEach((s) => {
    text += `• ${s.key}: ${String(s.value).slice(0, 80)}\n`;
  });

  await ctx.reply(text, Keyboards.adminMenu());
});

bot.hears('🛡 Xavfsizlik', async (ctx) => {
  if (!ctx.state.isAdmin) return;
  const bannedCount = await dbGet(`SELECT COUNT(*) as count FROM users WHERE is_banned = 1`);
  await ctx.reply(`🛡 Xavfsizlik holati:\n\n🚫 Bloklangan foydalanuvchilar: ${bannedCount?.count || 0}`, Keyboards.adminMenu());
});

bot.hears('📝 Loglar', async (ctx) => {
  if (!ctx.state.isAdmin) return;
  const logs = await dbAll(`SELECT * FROM logs ORDER BY created_at DESC LIMIT 20`);

  if (!logs.length) return ctx.reply('Loglar topilmadi.', Keyboards.adminMenu());

  let text = '📝 So‘nggi loglar:\n\n';
  logs.forEach((l) => {
    text += `• ${l.created_at} | ${l.action}\n`;
  });

  await ctx.reply(text, Keyboards.adminMenu());
});

bot.hears('🏠 User menyu', async (ctx) => {
  if (!ctx.state.isAdmin) return;
  await ctx.reply('User menyu:', Keyboards.mainMenu(ctx.state.isAdmin));
});

bot.hears('❌ Yopish', async (ctx) => {
  if (!ctx.state.isAdmin) return;
  await ctx.reply('Admin panel yopildi.', Keyboards.mainMenu(ctx.state.isAdmin));
});

// ==================================================
// CALLBACK FALLBACK
// ==================================================
bot.on('callback_query', async (ctx, next) => {
  return next();
});

// ==================================================
// ERROR HANDLER
// ==================================================
bot.catch((err, ctx) => {
  console.error(`XATOLIK (${ctx.updateType}):`, err);
  try {
    ctx.reply('🌐 Hozircha aloqa bilan kichik muammo kuzatilmoqda. Iltimos, birozdan keyin qayta urinib ko‘ring.');
  } catch (_) {}
});

// ==================================================
// START
// ==================================================
async function start() {
  console.log('Bot ishga tushmoqda...');
  await initDB();
  await bot.launch();
  console.log('Bot muvaffaqiyatli ishga tushdi!');
}

start().catch((err) => {
  console.error('Botni ishga tushirishda xato:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));