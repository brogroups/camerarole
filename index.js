import { Telegraf, Scenes, session, Markup } from 'telegraf';
import dotenv from 'dotenv';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = String(process.env.ADMIN_IDS || process.env.ADMIN_ID || '')
  .split(',')
  .map((id) => Number(String(id).trim()))
  .filter((id) => Number.isFinite(id));

const DATA_PATH = path.join(__dirname, 'data.json');

if (!BOT_TOKEN) {
  console.error('CRITICAL ERROR: BOT_TOKEN .env ichida topilmadi');
  process.exit(1);
}

const ORDER_STATUS = {
  NEW: 'Yangi',
  WAITING_PAYMENT: 'To‘lov kutilmoqda',
  PENDING_VERIFY: 'To‘lov tekshirilmoqda',
  CONFIRMED: 'Tasdiqlandi',
  PROCESSING: 'Jarayonda',
  COMPLETED: 'Bajarildi',
  CANCELED: 'Bekor qilindi',
};

const PAYMENT_STATUS = {
  PENDING: 'Kutilmoqda',
  APPROVED: 'Tasdiqlandi',
  REJECTED: 'Rad etildi',
};

const SERVICE_TYPES = {
  STANDARD: 'standard',
  DYNAMIC_QUANTITY: 'dynamic_quantity',
  CUSTOM_TEXT: 'custom_text',
};

const DEFAULT_DATA = {
  counters: {
    categories: 0,
    services: 0,
    orders: 0,
    payments: 0,
    payment_methods: 0,
    users: 0,
    logs: 0,
  },
  users: [],
  categories: [],
  services: [],
  orders: [],
  payments: [],
  payment_methods: [],
  logs: [],
  settings: {
    brand_name: 'Pro Service Bot',
    support_username: 'admin_username',
    force_join_enabled: false,
    force_join_channels: [],
    welcome_text:
      '👋 Assalomu alaykum!\n\nProfessional xizmatlar botiga xush kelibsiz. Pastdagi menyudan kerakli xizmatni tanlang.',
    faq_text:
      '❓ Yordam\n\n1) Xizmatni tanlang.\n2) Username yoki link yuboring.\n3) Miqdorni kiriting.\n4) To‘lov qiling va chek yuboring.\n5) Admin tasdiqlagach buyurtma ishga olinadi.',
    rules_text:
      'ℹ️ Bot haqida\n\nBu bot orqali Telegram Premium, SMM nakrutka, kanal/guruh uchun aktiv jonli kontakt va boshqa xizmatlarni buyurtma qilishingiz mumkin.',
  },
};

let dbData = null;

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeText(value) {
  return String(value || '').trim();
}

function isAdmin(ctx) {
  return ADMIN_IDS.includes(Number(ctx.from?.id));
}

function ensureTable(name) {
  if (!dbData[name]) dbData[name] = [];
  return dbData[name];
}

function ensureSettings() {
  if (!dbData.settings) dbData.settings = clone(DEFAULT_DATA.settings);
  dbData.settings = { ...DEFAULT_DATA.settings, ...dbData.settings };
  return dbData.settings;
}

function getSetting(key, fallback = '') {
  return ensureSettings()[key] ?? fallback;
}

async function setSetting(key, value) {
  ensureSettings()[key] = value;
  await saveData();
}

function nextId(table) {
  if (!dbData.counters) dbData.counters = clone(DEFAULT_DATA.counters);
  if (typeof dbData.counters[table] !== 'number') dbData.counters[table] = 0;
  dbData.counters[table] += 1;
  return dbData.counters[table];
}

async function ensureDataFile() {
  if (!fs.existsSync(DATA_PATH)) {
    await fsp.writeFile(DATA_PATH, JSON.stringify(DEFAULT_DATA, null, 2), 'utf8');
  }
}

async function loadData() {
  await ensureDataFile();
  try {
    const raw = await fsp.readFile(DATA_PATH, 'utf8');
    dbData = JSON.parse(raw);
  } catch {
    dbData = clone(DEFAULT_DATA);
  }

  dbData.counters = { ...DEFAULT_DATA.counters, ...(dbData.counters || {}) };
  dbData.users = Array.isArray(dbData.users) ? dbData.users : [];
  dbData.categories = Array.isArray(dbData.categories) ? dbData.categories : [];
  dbData.services = Array.isArray(dbData.services) ? dbData.services : [];
  dbData.orders = Array.isArray(dbData.orders) ? dbData.orders : [];
  dbData.payments = Array.isArray(dbData.payments) ? dbData.payments : [];
  dbData.payment_methods = Array.isArray(dbData.payment_methods) ? dbData.payment_methods : [];
  dbData.logs = Array.isArray(dbData.logs) ? dbData.logs : [];
  dbData.settings = { ...DEFAULT_DATA.settings, ...(dbData.settings || {}) };
  await saveData();
}

async function saveData() {
  if (!dbData) dbData = clone(DEFAULT_DATA);
  await fsp.writeFile(DATA_PATH, JSON.stringify(dbData, null, 2), 'utf8');
}

async function logAction(action, details = '') {
  ensureTable('logs').push({
    id: nextId('logs'),
    action,
    details: String(details),
    created_at: nowIso(),
  });
  await saveData();
}

function formatPrice(price) {
  return `${Number(price || 0).toLocaleString('uz-UZ')} so‘m`;
}

function cleanUsername(username) {
  return safeText(username).replace(/^@+/, '');
}

function validateUsername(value) {
  return /^@?[a-zA-Z0-9_]{5,32}$/.test(safeText(value));
}

function validateLinkOrUsername(value) {
  const text = safeText(value);
  return validateUsername(text) || /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i.test(text) || /^https?:\/\/t\.me\/\S+$/i.test(text);
}

function normalizeTarget(value) {
  const text = safeText(value);
  if (validateUsername(text)) return `@${cleanUsername(text)}`;
  if (/^https?:\/\//i.test(text)) return text;
  if (/^t\.me\//i.test(text)) return `https://${text}`;
  return text;
}

function parsePositiveInt(value) {
  const n = Number(String(value || '').replace(/\s/g, ''));
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function paymentText() {
  const methods = ensureTable('payment_methods').filter((m) => Number(m.is_active) === 1);
  if (!methods.length) return '💳 To‘lov usullari hali qo‘shilmagan.';
  return `💳 To‘lov usullari:\n\n${methods.map((m, i) => `${i + 1}. ${m.title}\n${m.details}`).join('\n\n')}`;
}

function userMainKeyboard() {
  return Markup.keyboard([
    ['🛍 Xizmatlar', '📦 Buyurtmalarim'],
    ['💳 To‘lov usullari', '📩 Admin'],
    ['❓ Yordam', 'ℹ️ Bot haqida'],
  ]).resize();
}

function adminMainKeyboard() {
  return Markup.keyboard([
    ['📊 Statistika', '📦 Buyurtmalar'],
    ['💰 To‘lovlar', '📣 Xabar yuborish'],
    ['🗂 Kategoriyalar', '🛠 Xizmatlar'],
    ['🧾 To‘lov usullari', '🤖 Bot holati'],
    ['⚙️ Sozlamalar'],
  ]).resize();
}

function homeKeyboard(ctx) {
  return isAdmin(ctx) ? adminMainKeyboard() : userMainKeyboard();
}

function serviceMenuKeyboard() {
  const categories = ensureTable('categories')
    .filter((c) => Number(c.is_active) === 1)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  const rows = [];
  for (let i = 0; i < categories.length; i += 2) {
    rows.push(categories.slice(i, i + 2).map((c) => Markup.button.callback(c.title, `CAT_${c.id}`)));
  }
  rows.push([Markup.button.callback('🔙 Orqaga', 'BACK_HOME')]);
  return Markup.inlineKeyboard(rows);
}

function serviceListKeyboard(categoryId) {
  const services = ensureTable('services')
    .filter((s) => Number(s.category_id) === Number(categoryId) && Number(s.is_active) === 1)
    .sort((a, b) => Number(a.sort_order || a.id) - Number(b.sort_order || b.id));

  const rows = [];
  for (let i = 0; i < services.length; i += 2) {
    rows.push(
      services.slice(i, i + 2).map((s) => Markup.button.callback(s.button_title || s.title, `SVC_${s.id}`))
    );
  }
  rows.push([Markup.button.callback('🔙 Xizmatlarga qaytish', 'OPEN_SERVICES')]);
  return Markup.inlineKeyboard(rows);
}

function buildPaymentMethodsInline(prefix = 'PAY_METHOD_') {
  const methods = ensureTable('payment_methods').filter((m) => Number(m.is_active) === 1);
  const rows = methods.map((m) => [Markup.button.callback(m.title, `${prefix}${m.id}`)]);
  rows.push([Markup.button.callback('❌ Bekor qilish', 'CANCEL_SCENE')]);
  return Markup.inlineKeyboard(rows);
}

function findCategoryById(id) {
  return ensureTable('categories').find((c) => Number(c.id) === Number(id)) || null;
}

function findServiceById(id) {
  return ensureTable('services').find((s) => Number(s.id) === Number(id)) || null;
}

function findOrderById(id) {
  return ensureTable('orders').find((o) => Number(o.id) === Number(id)) || null;
}

function findPaymentByOrderId(orderId) {
  return ensureTable('payments').find((p) => Number(p.order_id) === Number(orderId)) || null;
}

function findPaymentMethodById(id) {
  return ensureTable('payment_methods').find((m) => Number(m.id) === Number(id)) || null;
}

function findUserByTelegramId(id) {
  return ensureTable('users').find((u) => Number(u.telegram_id) === Number(id)) || null;
}

function formatDetails(details) {
  const obj = typeof details === 'object' && details ? details : {};
  const rows = Object.entries(obj).map(([k, v]) => `• ${k}: ${v}`);
  return rows.length ? rows.join('\n') : '-';
}

function orderAdminKeyboard(orderId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ To‘lovni tasdiqlash', `APPROVE_PAY_${orderId}`), Markup.button.callback('❌ Rad etish', `REJECT_PAY_${orderId}`)],
    [Markup.button.callback('🚀 Jarayonga olish', `START_WORK_${orderId}`), Markup.button.callback('🏁 Bajarildi', `COMPLETE_ORDER_${orderId}`)],
    [Markup.button.callback('🛑 Bekor qilish', `CANCEL_ORDER_${orderId}`)],
  ]);
}

function categoryAdminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Kategoriya qo‘shish', 'ADM_CAT_ADD')],
    [Markup.button.callback('✏️ Kategoriya update', 'ADM_CAT_UPDATE')],
    [Markup.button.callback('➖ Kategoriya o‘chirish', 'ADM_CAT_DELETE')],
    [Markup.button.callback('✅/❌ Aktiv/Nofaol', 'ADM_CAT_TOGGLE')],
  ]);
}

function serviceAdminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Xizmat qo‘shish', 'ADM_SVC_ADD')],
    [Markup.button.callback('✏️ Xizmat update', 'ADM_SVC_UPDATE')],
    [Markup.button.callback('➖ Xizmat o‘chirish', 'ADM_SVC_DELETE')],
    [Markup.button.callback('✅/❌ Aktiv/Nofaol', 'ADM_SVC_TOGGLE')],
  ]);
}

function paymentAdminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Karta qo‘shish', 'ADM_PAY_ADD')],
    [Markup.button.callback('✏️ Karta update', 'ADM_PAY_UPDATE')],
    [Markup.button.callback('➖ Karta o‘chirish', 'ADM_PAY_DELETE')],
    [Markup.button.callback('✅/❌ Aktiv/Nofaol', 'ADM_PAY_TOGGLE')],
  ]);
}

function settingsKeyboard() {
  const force = getSetting('force_join_enabled', false) ? '✅ Yoqilgan' : '❌ O‘chirilgan';
  return Markup.inlineKeyboard([
    [Markup.button.callback(`Majburiy obuna: ${force}`, 'SET_FORCE_TOGGLE')],
    [Markup.button.callback('➕ Kanal qo‘shish', 'SET_CHANNEL_ADD'), Markup.button.callback('➖ Kanal o‘chirish', 'SET_CHANNEL_DELETE')],
    [Markup.button.callback('📢 Kanallar ro‘yxati', 'SET_CHANNEL_LIST')],
    [Markup.button.callback('✏️ Welcome matn', 'SET_WELCOME')],
    [Markup.button.callback('✏️ Yordam matn', 'SET_FAQ')],
    [Markup.button.callback('✏️ Bot haqida matn', 'SET_RULES')],
    [Markup.button.callback('✏️ Admin username', 'SET_SUPPORT')],
  ]);
}

async function saveUser(ctx) {
  if (!ctx.from || ctx.chat?.type !== 'private') return;
  const telegramId = Number(ctx.from.id);
  const old = findUserByTelegramId(telegramId);
  if (old) {
    old.first_name = ctx.from.first_name || old.first_name || 'User';
    old.last_name = ctx.from.last_name || old.last_name || '';
    old.username = ctx.from.username || old.username || null;
    old.role = isAdmin(ctx) ? 'admin' : old.role || 'user';
    old.last_active = nowIso();
  } else {
    ensureTable('users').push({
      id: nextId('users'),
      telegram_id: telegramId,
      first_name: ctx.from.first_name || 'User',
      last_name: ctx.from.last_name || '',
      username: ctx.from.username || null,
      role: isAdmin(ctx) ? 'admin' : 'user',
      is_banned: 0,
      join_date: nowIso(),
      last_active: nowIso(),
    });
  }
  await saveData();
}

async function seedInitialData() {
  const categories = ensureTable('categories');
  const services = ensureTable('services');
  const paymentMethods = ensureTable('payment_methods');

  if (!categories.length) {
    const seedCategories = [
      { title: '⭐ Telegram Premium', sort_order: 1, is_active: 1 },
      { title: '📈 SMM xizmatlari', sort_order: 2, is_active: 1 },
      { title: '👥 Aktiv kontakt', sort_order: 3, is_active: 1 },
      { title: '📦 Maxsus xizmat', sort_order: 4, is_active: 1 },
    ];
    for (const c of seedCategories) categories.push({ id: nextId('categories'), ...c, created_at: nowIso() });
  }

  if (!services.length) {
    const premium = categories.find((c) => c.title.includes('Premium'));
    const smm = categories.find((c) => c.title.includes('SMM'));
    const active = categories.find((c) => c.title.includes('Aktiv'));
    const custom = categories.find((c) => c.title.includes('Maxsus'));

    const seedServices = [
      {
        category_id: premium?.id,
        title: 'Telegram Premium 1 oylik',
        button_title: '1 oylik — 55 000',
        description: 'Telegram Premium 1 oylik tarif. Username yuborasiz, to‘lovdan keyin buyurtma ishga olinadi.',
        price: 55000,
        type: SERVICE_TYPES.STANDARD,
        required_fields: ['target'],
        delivery_time: '10 daqiqa - 24 soat',
        sort_order: 1,
        is_active: 1,
      },
      {
        category_id: premium?.id,
        title: 'Telegram Premium 3 oylik',
        button_title: '3 oylik — 190 000',
        description: 'Telegram Premium 3 oylik tarif.',
        price: 190000,
        type: SERVICE_TYPES.STANDARD,
        required_fields: ['target'],
        delivery_time: '10 daqiqa - 24 soat',
        sort_order: 2,
        is_active: 1,
      },
      {
        category_id: premium?.id,
        title: 'Telegram Premium 6 oylik',
        button_title: '6 oylik — 270 000',
        description: 'Telegram Premium 6 oylik tarif.',
        price: 270000,
        type: SERVICE_TYPES.STANDARD,
        required_fields: ['target'],
        delivery_time: '10 daqiqa - 24 soat',
        sort_order: 3,
        is_active: 1,
      },
      {
        category_id: premium?.id,
        title: 'Telegram Premium 1 yillik',
        button_title: '1 yillik — 340 000',
        description: 'Telegram Premium 1 yillik tarif.',
        price: 340000,
        type: SERVICE_TYPES.STANDARD,
        required_fields: ['target'],
        delivery_time: '10 daqiqa - 24 soat',
        sort_order: 4,
        is_active: 1,
      },
      {
        category_id: smm?.id,
        title: 'Instagram oddiy nakrutka',
        button_title: 'Instagram oddiy',
        description: 'Instagram oddiy nakrutka. Minimal buyurtma: 1000 ta. 1000 tasi: 35 000 so‘m.',
        price_per_1000: 35000,
        min_quantity: 1000,
        type: SERVICE_TYPES.DYNAMIC_QUANTITY,
        required_fields: ['target', 'quantity'],
        delivery_time: 'Tezkor',
        sort_order: 1,
        is_active: 1,
      },
      {
        category_id: smm?.id,
        title: 'Instagram bez minus 1 yillik',
        button_title: 'Instagram bez minus',
        description: 'Instagram bez minus 1 yillik. Minimal buyurtma: 1000 ta. 1000 tasi: 50 000 so‘m.',
        price_per_1000: 50000,
        min_quantity: 1000,
        type: SERVICE_TYPES.DYNAMIC_QUANTITY,
        required_fields: ['target', 'quantity'],
        delivery_time: 'Tezkor',
        sort_order: 2,
        is_active: 1,
      },
      {
        category_id: smm?.id,
        title: 'TikTok nakrutka',
        button_title: 'TikTok nakrutka',
        description: 'TikTok uchun nakrutka xizmati. Tafsilot admin bilan kelishiladi.',
        price: 0,
        type: SERVICE_TYPES.CUSTOM_TEXT,
        required_fields: ['target', 'note'],
        delivery_time: 'Kelishiladi',
        sort_order: 3,
        is_active: 1,
      },
      {
        category_id: smm?.id,
        title: 'YouTube nakrutka',
        button_title: 'YouTube nakrutka',
        description: 'YouTube uchun nakrutka xizmati. Tafsilot admin bilan kelishiladi.',
        price: 0,
        type: SERVICE_TYPES.CUSTOM_TEXT,
        required_fields: ['target', 'note'],
        delivery_time: 'Kelishiladi',
        sort_order: 4,
        is_active: 1,
      },
      {
        category_id: active?.id,
        title: 'Kanal/guruhga aktiv jonli kontakt — 500',
        button_title: '500 — 25 ming',
        description: 'Guruh yoki kanalga aktiv jonli kontakt qo‘shish. Paket: 500 ta.',
        price: 25000,
        type: SERVICE_TYPES.STANDARD,
        required_fields: ['target'],
        delivery_time: 'Kelishiladi',
        sort_order: 1,
        is_active: 1,
      },
      {
        category_id: active?.id,
        title: 'Kanal/guruhga aktiv jonli kontakt — 1000 + 100 bonus',
        button_title: '1000 — 50 ming +100 bonus',
        description: 'Aktiv jonli kontakt. Paket: 1000 ta + 100 bonus.',
        price: 50000,
        type: SERVICE_TYPES.STANDARD,
        required_fields: ['target'],
        delivery_time: 'Kelishiladi',
        sort_order: 2,
        is_active: 1,
      },
      {
        category_id: active?.id,
        title: 'Kanal/guruhga aktiv jonli kontakt — 2000 + 200 bonus',
        button_title: '2000 — 100 ming +200 bonus',
        description: 'Aktiv jonli kontakt. Paket: 2000 ta + 200 bonus.',
        price: 100000,
        type: SERVICE_TYPES.STANDARD,
        required_fields: ['target'],
        delivery_time: 'Kelishiladi',
        sort_order: 3,
        is_active: 1,
      },
      {
        category_id: active?.id,
        title: 'Kanal/guruhga aktiv jonli kontakt — 3000 + 300 bonus',
        button_title: '3000 — 150 ming +300 bonus',
        description: 'Aktiv jonli kontakt. Paket: 3000 ta + 300 bonus.',
        price: 150000,
        type: SERVICE_TYPES.STANDARD,
        required_fields: ['target'],
        delivery_time: 'Kelishiladi',
        sort_order: 4,
        is_active: 1,
      },
      {
        category_id: active?.id,
        title: 'Kanal/guruhga aktiv jonli kontakt — 4000 + 400 bonus',
        button_title: '4000 — 200 ming +400 bonus',
        description: 'Aktiv jonli kontakt. Paket: 4000 ta + 400 bonus.',
        price: 200000,
        type: SERVICE_TYPES.STANDARD,
        required_fields: ['target'],
        delivery_time: 'Kelishiladi',
        sort_order: 5,
        is_active: 1,
      },
      {
        category_id: active?.id,
        title: 'Kanal/guruhga aktiv jonli kontakt — 5000 + 500 bonus',
        button_title: '5000 — 250 ming +500 bonus',
        description: 'Aktiv jonli kontakt. Paket: 5000 ta + 500 bonus.',
        price: 250000,
        type: SERVICE_TYPES.STANDARD,
        required_fields: ['target'],
        delivery_time: 'Kelishiladi',
        sort_order: 6,
        is_active: 1,
      },
      {
        category_id: custom?.id,
        title: 'Maxsus xizmat',
        button_title: 'Maxsus xizmat',
        description: 'Sizga kerakli xizmatni yozib qoldiring. Admin narx va muddatni aytadi.',
        price: 0,
        type: SERVICE_TYPES.CUSTOM_TEXT,
        required_fields: ['note'],
        delivery_time: 'Kelishiladi',
        sort_order: 1,
        is_active: 1,
      },
    ];

    for (const s of seedServices) {
      if (!s.category_id) continue;
      services.push({ id: nextId('services'), created_at: nowIso(), ...s });
    }
  }

  if (!paymentMethods.length) {
    paymentMethods.push({
      id: nextId('payment_methods'),
      title: '💳 Uzcard / Humo',
      details: 'Karta: 8600 0000 0000 0000\nEga: Ism Familiya',
      is_active: 1,
      created_at: nowIso(),
    });
  }

  await saveData();
}

async function getForceJoinChannels() {
  const channels = getSetting('force_join_channels', []);
  return Array.isArray(channels) ? channels : [];
}

async function isForceJoinPassed(ctx) {
  if (isAdmin(ctx)) return true;
  if (!getSetting('force_join_enabled', false)) return true;
  const channels = await getForceJoinChannels();
  if (!channels.length) return true;

  for (const item of channels) {
    const chatId = item.chat_id || item.username;
    if (!chatId) continue;
    try {
      const member = await ctx.telegram.getChatMember(chatId, ctx.from.id);
      if (!['creator', 'administrator', 'member'].includes(member.status)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function showForceJoin(ctx) {
  const channels = await getForceJoinChannels();
  const rows = channels
    .filter((c) => c.username)
    .map((c) => [Markup.button.url(c.title || `@${cleanUsername(c.username)}`, `https://t.me/${cleanUsername(c.username)}`)]);
  rows.push([Markup.button.callback('✅ Tekshirish', 'CHECK_FORCE_JOIN')]);
  const text = '📢 Botdan foydalanish uchun avval kanallarga obuna bo‘ling, keyin Tekshirish tugmasini bosing.';
  await ctx.reply(text, { reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}

async function guard(ctx, next) {
  if (!ctx.from || ctx.chat?.type !== 'private') return;
  const ok = await isForceJoinPassed(ctx);
  if (!ok) {
    if (ctx.callbackQuery) await ctx.answerCbQuery('Avval obuna bo‘ling', { show_alert: true }).catch(() => {});
    await showForceJoin(ctx);
    return;
  }
  return next();
}

const orderScene = new Scenes.WizardScene(
  'ORDER_SCENE',
  async (ctx) => {
    const service = findServiceById(ctx.scene.state.serviceId);
    if (!service || Number(service.is_active) !== 1) {
      await ctx.reply('Xizmat topilmadi.', homeKeyboard(ctx));
      return ctx.scene.leave();
    }

    ctx.scene.state.service = clone(service);
    ctx.scene.state.responses = {};
    ctx.scene.state.stepFields = Array.isArray(service.required_fields) ? clone(service.required_fields) : ['target'];
    ctx.scene.state.fieldIndex = 0;

    const priceLine = service.type === SERVICE_TYPES.DYNAMIC_QUANTITY
      ? `💰 1000 tasi: ${formatPrice(service.price_per_1000)}\n🔢 Minimal: ${service.min_quantity || 1000} ta`
      : `💰 Narx: ${Number(service.price || 0) > 0 ? formatPrice(service.price) : 'Kelishiladi'}`;

    await ctx.reply(
      [`📦 ${service.title}`, '', service.description || '', priceLine, `⏱ Muddat: ${service.delivery_time || 'Kelishiladi'}`].join('\n'),
      Markup.keyboard([['❌ Bekor qilish']]).resize()
    );

    const field = ctx.scene.state.stepFields[0];
    await ctx.reply(fieldPrompt(field, service));
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message?.text === '❌ Bekor qilish') {
      await ctx.reply('❌ Buyurtma bekor qilindi.', homeKeyboard(ctx));
      return ctx.scene.leave();
    }
    if (!ctx.message?.text) {
      await ctx.reply('Iltimos, matn yuboring.');
      return;
    }

    const service = ctx.scene.state.service;
    const field = ctx.scene.state.stepFields[ctx.scene.state.fieldIndex];
    const value = safeText(ctx.message.text);

    if (field === 'target' && !validateLinkOrUsername(value)) {
      await ctx.reply('Username yoki link noto‘g‘ri. Masalan: @username yoki https://t.me/link');
      return;
    }

    if (field === 'quantity') {
      const q = parsePositiveInt(value);
      const min = Number(service.min_quantity || 1000);
      if (!q || q < min) {
        await ctx.reply(`Eng kam miqdor ${min} ta. Iltimos, ${min} yoki undan ko‘p son yozing.`);
        return;
      }
      ctx.scene.state.responses.quantity = q;
    } else if (field === 'target') {
      ctx.scene.state.responses.target = normalizeTarget(value);
    } else {
      ctx.scene.state.responses[field] = value;
    }

    ctx.scene.state.fieldIndex += 1;

    if (ctx.scene.state.fieldIndex < ctx.scene.state.stepFields.length) {
      const nextField = ctx.scene.state.stepFields[ctx.scene.state.fieldIndex];
      await ctx.reply(fieldPrompt(nextField, service));
      return;
    }

    let amount = Number(service.price || 0);
    if (service.type === SERVICE_TYPES.DYNAMIC_QUANTITY) {
      amount = Math.ceil((Number(ctx.scene.state.responses.quantity) / 1000) * Number(service.price_per_1000 || 0));
    }
    ctx.scene.state.amount = amount;

    let text = '📋 Buyurtma yakuni:\n\n';
    text += `📦 Xizmat: ${service.title}\n`;
    text += `💰 Summa: ${amount > 0 ? formatPrice(amount) : 'Kelishiladi'}\n`;
    text += `⏱ Muddat: ${service.delivery_time || 'Kelishiladi'}\n\n`;
    text += '📝 Ma’lumotlar:\n';
    text += formatDetails(ctx.scene.state.responses);

    if (amount > 0) {
      await ctx.reply(text, {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('➡️ To‘lovga o‘tish', 'GO_PAYMENT')],
          [Markup.button.callback('❌ Bekor qilish', 'CANCEL_SCENE')],
        ]).reply_markup,
      });
      return ctx.wizard.next();
    }

    await ctx.reply(`${text}\n\nBu buyurtma admin bilan kelishiladi. Yuboramizmi?`, {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('✅ Adminga yuborish', 'SUBMIT_NO_PAYMENT')],
        [Markup.button.callback('❌ Bekor qilish', 'CANCEL_SCENE')],
      ]).reply_markup,
    });
    return ctx.wizard.selectStep(4);
  },
  async (ctx) => {
    if (!ctx.callbackQuery?.data?.startsWith('PAY_METHOD_')) return;
    const methodId = Number(ctx.callbackQuery.data.replace('PAY_METHOD_', ''));
    const method = findPaymentMethodById(methodId);
    if (!method || Number(method.is_active) !== 1) {
      await ctx.answerCbQuery('To‘lov usuli topilmadi');
      return;
    }
    ctx.scene.state.method = method;
    await ctx.answerCbQuery();
    await ctx.reply(
      `💳 ${method.title}\n\n${method.details}\n\n💰 To‘lov summasi: ${formatPrice(ctx.scene.state.amount)}\n\n📸 Endi to‘lov chekini rasm qilib yuboring.`,
      Markup.keyboard([['❌ Bekor qilish']]).resize()
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message?.text === '❌ Bekor qilish') {
      await ctx.reply('❌ Buyurtma bekor qilindi.', homeKeyboard(ctx));
      return ctx.scene.leave();
    }
    if (!ctx.message?.photo) {
      await ctx.reply('Iltimos, to‘lov cheki rasmini yuboring.');
      return;
    }

    const receiptFileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    await createOrder(ctx, receiptFileId);
    return ctx.scene.leave();
  },
  async (ctx) => {
    if (ctx.callbackQuery?.data !== 'SUBMIT_NO_PAYMENT') return;
    await ctx.answerCbQuery('Yuborildi');
    await createOrder(ctx, null);
    return ctx.scene.leave();
  }
);

function fieldPrompt(field, service) {
  if (field === 'target') return '👤 Username yoki kanal/guruh/post linkini yuboring. Masalan: @username yoki https://t.me/kanal';
  if (field === 'quantity') return `🔢 Nechta tushirmoqchisiz? Eng kami ${service.min_quantity || 1000} ta. Raqam bilan yozing.`;
  if (field === 'note') return '📝 Buyurtma bo‘yicha qo‘shimcha izoh yozing.';
  return 'Kerakli ma’lumotni yuboring.';
}

async function createOrder(ctx, receiptFileId = null) {
  const service = ctx.scene.state.service;
  const amount = Number(ctx.scene.state.amount || 0);
  const orderId = nextId('orders');
  const userId = Number(ctx.from.id);

  const order = {
    id: orderId,
    user_id: userId,
    service_id: service.id,
    service_title: service.title,
    amount,
    status: receiptFileId ? ORDER_STATUS.PENDING_VERIFY : ORDER_STATUS.NEW,
    details: clone(ctx.scene.state.responses),
    admin_comment: amount > 0 ? '' : 'Narx admin bilan kelishiladi',
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  ensureTable('orders').push(order);

  let payment = null;
  if (receiptFileId) {
    payment = {
      id: nextId('payments'),
      order_id: orderId,
      user_id: userId,
      method: ctx.scene.state.method?.title || '-',
      amount,
      receipt_file_id: receiptFileId,
      status: PAYMENT_STATUS.PENDING,
      admin_reason: '',
      created_at: nowIso(),
    };
    ensureTable('payments').push(payment);
  }

  await saveData();
  await logAction('ORDER_CREATED', `order_id=${orderId}; user_id=${userId}; amount=${amount}`);

  await ctx.reply(
    `✅ Buyurtmangiz qabul qilindi!\n\n🆔 ID: #${orderId}\n📦 Xizmat: ${service.title}\n💰 Summa: ${amount > 0 ? formatPrice(amount) : 'Kelishiladi'}\n🏷 Holat: ${order.status}\n\nAdmin tez orada tekshiradi.`,
    homeKeyboard(ctx)
  );

  const client = `${ctx.from.first_name || 'User'}${ctx.from.username ? ` (@${ctx.from.username})` : ''}`;
  const adminText = [
    `🆕 Yangi buyurtma #${orderId}`,
    `👤 Mijoz: ${client}`,
    `🆔 Telegram ID: ${userId}`,
    `📦 Xizmat: ${service.title}`,
    `💰 Summa: ${amount > 0 ? formatPrice(amount) : 'Kelishiladi'}`,
    `🏷 Holat: ${order.status}`,
    '',
    '📝 Tafsilotlar:',
    formatDetails(order.details),
  ].join('\n');

  for (const adminId of ADMIN_IDS) {
    try {
      if (receiptFileId) {
        await ctx.telegram.sendPhoto(adminId, receiptFileId, {
          caption: adminText,
          reply_markup: orderAdminKeyboard(orderId).reply_markup,
        });
      } else {
        await ctx.telegram.sendMessage(adminId, adminText, { reply_markup: orderAdminKeyboard(orderId).reply_markup });
      }
    } catch (err) {
      console.error('Admin notify error:', err.message);
    }
  }
}

orderScene.action('GO_PAYMENT', async (ctx) => {
  await ctx.answerCbQuery();
  const methods = ensureTable('payment_methods').filter((m) => Number(m.is_active) === 1);
  if (!methods.length) {
    await ctx.reply('To‘lov kartasi hali qo‘shilmagan. Admin bilan bog‘laning.', homeKeyboard(ctx));
    return ctx.scene.leave();
  }
  await ctx.reply('💳 To‘lov usulini tanlang:', { reply_markup: buildPaymentMethodsInline('PAY_METHOD_').reply_markup });
  return ctx.wizard.selectStep(2);
});

orderScene.action('CANCEL_SCENE', async (ctx) => {
  await ctx.answerCbQuery('Bekor qilindi').catch(() => {});
  await ctx.reply('❌ Bekor qilindi.', homeKeyboard(ctx));
  return ctx.scene.leave();
});

const broadcastScene = new Scenes.WizardScene(
  'BROADCAST_SCENE',
  async (ctx) => {
    if (!isAdmin(ctx)) return ctx.scene.leave();
    await ctx.reply('📣 Yuboriladigan xabarni yuboring. Matn, rasm, video ham bo‘ladi.', Markup.keyboard([['❌ Bekor qilish']]).resize());
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (ctx.message?.text === '❌ Bekor qilish') {
      await ctx.reply('Bekor qilindi.', adminMainKeyboard());
      return ctx.scene.leave();
    }
    if (!ctx.message) {
      await ctx.reply('Xabar yuboring.');
      return;
    }
    ctx.scene.state.messageId = ctx.message.message_id;
    ctx.scene.state.chatId = ctx.chat.id;
    await ctx.reply('Hamma foydalanuvchilarga yuborilsinmi?', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('✅ Ha', 'BROADCAST_YES'), Markup.button.callback('❌ Yo‘q', 'BROADCAST_NO')],
      ]).reply_markup,
    });
    return ctx.wizard.next();
  }
);

broadcastScene.action('BROADCAST_YES', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.answerCbQuery();
  const users = ensureTable('users').filter((u) => Number(u.is_banned) !== 1);
  let ok = 0;
  let fail = 0;
  await ctx.reply('⏳ Xabar yuborilmoqda...');
  for (const u of users) {
    try {
      await ctx.telegram.copyMessage(u.telegram_id, ctx.scene.state.chatId, ctx.scene.state.messageId);
      ok += 1;
    } catch {
      fail += 1;
    }
  }
  await logAction('BROADCAST', `ok=${ok}; fail=${fail}`);
  await ctx.reply(`✅ Yuborildi\n\nJami: ${users.length}\nYetdi: ${ok}\nXato: ${fail}`, adminMainKeyboard());
  return ctx.scene.leave();
});

broadcastScene.action('BROADCAST_NO', async (ctx) => {
  await ctx.answerCbQuery('Bekor qilindi');
  await ctx.reply('Bekor qilindi.', adminMainKeyboard());
  return ctx.scene.leave();
});

const adminEditScene = new Scenes.WizardScene(
  'ADMIN_EDIT_SCENE',
  async (ctx) => {
    if (!isAdmin(ctx)) return ctx.scene.leave();
    const mode = ctx.scene.state.mode;
    const prompts = {
      cat_add: '➕ Kategoriya qo‘shish\n\nFormat:\nNomi | tartib\n\nMasalan:\n⭐ Telegram Premium | 1',
      cat_update: '✏️ Kategoriya update\n\nFormat:\nID | yangi nom | tartib\n\nMasalan:\n1 | ⭐ Premium | 1',
      cat_delete: '➖ O‘chiriladigan kategoriya ID sini yuboring.',
      cat_toggle: '✅/❌ Aktiv/Nofaol qilish uchun kategoriya ID sini yuboring.',
      svc_add: '➕ Xizmat qo‘shish\n\nFormat:\nKategoriyaID | Tugma nomi | To‘liq nom | Narx | 1000 narxi | Min | Type | Muddat | Tavsif\n\nType: standard / dynamic_quantity / custom_text\nMasalan:\n2 | Instagram oddiy | Instagram oddiy nakrutka | 0 | 35000 | 1000 | dynamic_quantity | Tezkor | 1000 tasi 35 ming',
      svc_update: '✏️ Xizmat update\n\nFormat:\nID | KategoriyaID | Tugma nomi | To‘liq nom | Narx | 1000 narxi | Min | Type | Muddat | Tavsif',
      svc_delete: '➖ O‘chiriladigan xizmat ID sini yuboring.',
      svc_toggle: '✅/❌ Aktiv/Nofaol qilish uchun xizmat ID sini yuboring.',
      pay_add: '➕ Karta qo‘shish\n\nFormat:\nNomi | Karta ma’lumotlari\n\nMasalan:\n💳 Uzcard | Karta: 8600... Ega: Ali Valiyev',
      pay_update: '✏️ Karta update\n\nFormat:\nID | Nomi | Karta ma’lumotlari',
      pay_delete: '➖ O‘chiriladigan karta ID sini yuboring.',
      pay_toggle: '✅/❌ Aktiv/Nofaol qilish uchun karta ID sini yuboring.',
      welcome: 'Yangi welcome matnni yuboring.',
      faq: 'Yangi yordam matnni yuboring.',
      rules: 'Yangi bot haqida matnni yuboring.',
      support: 'Yangi admin username yuboring. Masalan: @username',
      channel_add: 'Majburiy obuna uchun kanal username yuboring. Masalan: @kanal',
      channel_delete: 'O‘chiriladigan kanal username yuboring. Masalan: @kanal',
    };
    await ctx.reply(prompts[mode] || 'Qiymat yuboring.', Markup.keyboard([['❌ Bekor qilish']]).resize());
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!isAdmin(ctx)) return ctx.scene.leave();
    if (ctx.message?.text === '❌ Bekor qilish') {
      await ctx.reply('Bekor qilindi.', adminMainKeyboard());
      return ctx.scene.leave();
    }
    if (!ctx.message?.text) {
      await ctx.reply('Iltimos, matn yuboring.');
      return;
    }

    const mode = ctx.scene.state.mode;
    const text = safeText(ctx.message.text);

    try {
      await handleAdminEdit(ctx, mode, text);
      await saveData();
      await ctx.reply('✅ Muvaffaqiyatli bajarildi.', adminMainKeyboard());
      return ctx.scene.leave();
    } catch (err) {
      await ctx.reply(`❌ Xato: ${err.message}\n\nFormatni to‘g‘ri yuboring yoki qaytadan urinib ko‘ring.`);
    }
  }
);

function splitParts(text) {
  return text.split('|').map((x) => safeText(x));
}

async function handleAdminEdit(ctx, mode, text) {
  if (mode === 'cat_add') {
    const [title, sort = '1'] = splitParts(text);
    if (!title) throw new Error('Kategoriya nomi kerak');
    ensureTable('categories').push({ id: nextId('categories'), title, sort_order: Number(sort) || 1, is_active: 1, created_at: nowIso() });
    return;
  }
  if (mode === 'cat_update') {
    const [id, title, sort = '1'] = splitParts(text);
    const c = findCategoryById(Number(id));
    if (!c) throw new Error('Kategoriya topilmadi');
    c.title = title || c.title;
    c.sort_order = Number(sort) || c.sort_order || 1;
    c.updated_at = nowIso();
    return;
  }
  if (mode === 'cat_delete') {
    const id = Number(text);
    dbData.categories = ensureTable('categories').filter((c) => Number(c.id) !== id);
    dbData.services = ensureTable('services').filter((s) => Number(s.category_id) !== id);
    return;
  }
  if (mode === 'cat_toggle') {
    const c = findCategoryById(Number(text));
    if (!c) throw new Error('Kategoriya topilmadi');
    c.is_active = Number(c.is_active) === 1 ? 0 : 1;
    return;
  }

  if (mode === 'svc_add' || mode === 'svc_update') {
    const parts = splitParts(text);
    const offset = mode === 'svc_update' ? 1 : 0;
    let service = null;
    if (mode === 'svc_update') {
      service = findServiceById(Number(parts[0]));
      if (!service) throw new Error('Xizmat topilmadi');
    }
    const categoryId = Number(parts[offset + 0]);
    const buttonTitle = parts[offset + 1];
    const title = parts[offset + 2];
    const price = Number(parts[offset + 3] || 0);
    const pricePer1000 = Number(parts[offset + 4] || 0);
    const minQuantity = Number(parts[offset + 5] || 0);
    const type = parts[offset + 6] || SERVICE_TYPES.STANDARD;
    const deliveryTime = parts[offset + 7] || 'Kelishiladi';
    const description = parts.slice(offset + 8).join(' | ') || title;

    if (!findCategoryById(categoryId)) throw new Error('Kategoriya ID noto‘g‘ri');
    if (!title) throw new Error('Xizmat nomi kerak');
    if (!Object.values(SERVICE_TYPES).includes(type)) throw new Error('Type noto‘g‘ri');

    const requiredFields = type === SERVICE_TYPES.DYNAMIC_QUANTITY ? ['target', 'quantity'] : type === SERVICE_TYPES.CUSTOM_TEXT ? ['target', 'note'] : ['target'];
    const payload = {
      category_id: categoryId,
      button_title: buttonTitle || title,
      title,
      description,
      price: Number.isFinite(price) ? price : 0,
      price_per_1000: Number.isFinite(pricePer1000) ? pricePer1000 : 0,
      min_quantity: Number.isFinite(minQuantity) && minQuantity > 0 ? minQuantity : 1000,
      type,
      delivery_time: deliveryTime,
      required_fields: requiredFields,
      is_active: 1,
      updated_at: nowIso(),
    };

    if (mode === 'svc_add') ensureTable('services').push({ id: nextId('services'), created_at: nowIso(), ...payload });
    else Object.assign(service, payload);
    return;
  }
  if (mode === 'svc_delete') {
    const id = Number(text);
    dbData.services = ensureTable('services').filter((s) => Number(s.id) !== id);
    return;
  }
  if (mode === 'svc_toggle') {
    const s = findServiceById(Number(text));
    if (!s) throw new Error('Xizmat topilmadi');
    s.is_active = Number(s.is_active) === 1 ? 0 : 1;
    return;
  }

  if (mode === 'pay_add') {
    const [title, ...detailsArr] = splitParts(text);
    const details = detailsArr.join(' | ');
    if (!title || !details) throw new Error('Nomi va karta ma’lumoti kerak');
    ensureTable('payment_methods').push({ id: nextId('payment_methods'), title, details, is_active: 1, created_at: nowIso() });
    return;
  }
  if (mode === 'pay_update') {
    const [id, title, ...detailsArr] = splitParts(text);
    const p = findPaymentMethodById(Number(id));
    if (!p) throw new Error('Karta topilmadi');
    p.title = title || p.title;
    p.details = detailsArr.join(' | ') || p.details;
    p.updated_at = nowIso();
    return;
  }
  if (mode === 'pay_delete') {
    const id = Number(text);
    dbData.payment_methods = ensureTable('payment_methods').filter((p) => Number(p.id) !== id);
    return;
  }
  if (mode === 'pay_toggle') {
    const p = findPaymentMethodById(Number(text));
    if (!p) throw new Error('Karta topilmadi');
    p.is_active = Number(p.is_active) === 1 ? 0 : 1;
    return;
  }

  if (mode === 'welcome') return setSetting('welcome_text', text);
  if (mode === 'faq') return setSetting('faq_text', text);
  if (mode === 'rules') return setSetting('rules_text', text);
  if (mode === 'support') {
    if (!validateUsername(text)) throw new Error('Username noto‘g‘ri');
    return setSetting('support_username', cleanUsername(text));
  }
  if (mode === 'channel_add') {
    if (!validateUsername(text)) throw new Error('Kanal username noto‘g‘ri');
    const username = cleanUsername(text);
    const channels = await getForceJoinChannels();
    if (!channels.some((c) => cleanUsername(c.username) === username)) {
      channels.push({ username, chat_id: `@${username}`, title: `@${username}` });
      await setSetting('force_join_channels', channels);
    }
    return;
  }
  if (mode === 'channel_delete') {
    const username = cleanUsername(text);
    const channels = await getForceJoinChannels();
    await setSetting('force_join_channels', channels.filter((c) => cleanUsername(c.username) !== username));
    return;
  }
}

const stage = new Scenes.Stage([orderScene, broadcastScene, adminEditScene]);
const bot = new Telegraf(BOT_TOKEN);

bot.use(session());
bot.use(stage.middleware());
bot.use(async (ctx, next) => {
  try {
    await saveUser(ctx);
  } catch (err) {
    console.error('saveUser error:', err.message);
  }
  return next();
});
bot.use(guard);

bot.start(async (ctx) => {
  if (isAdmin(ctx)) {
    await ctx.reply('🛠 Admin panelga xush kelibsiz. Sizga faqat admin menyu ko‘rinadi.', adminMainKeyboard());
  } else {
    await ctx.reply(getSetting('welcome_text'), userMainKeyboard());
  }
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply('🛠 Admin panel', adminMainKeyboard());
});

bot.action('CHECK_FORCE_JOIN', async (ctx) => {
  const ok = await isForceJoinPassed(ctx);
  await ctx.answerCbQuery(ok ? 'Tasdiqlandi' : 'Hali obuna bo‘lmadingiz');
  if (!ok) return showForceJoin(ctx);
  await ctx.reply('✅ Obuna tasdiqlandi.', homeKeyboard(ctx));
});

bot.hears('🛍 Xizmatlar', async (ctx) => {
  if (isAdmin(ctx)) return ctx.reply('Admin uchun xizmatlar boshqaruvi: 🛠 Xizmatlar tugmasidan foydalaning.', adminMainKeyboard());
  await ctx.reply('🛍 Kerakli xizmat turini tanlang:', { reply_markup: serviceMenuKeyboard().reply_markup });
});

bot.action('OPEN_SERVICES', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('🛍 Kerakli xizmat turini tanlang:', { reply_markup: serviceMenuKeyboard().reply_markup }).catch(async () => {
    await ctx.reply('🛍 Kerakli xizmat turini tanlang:', { reply_markup: serviceMenuKeyboard().reply_markup });
  });
});

bot.action(/^CAT_(\d+)$/, async (ctx) => {
  const category = findCategoryById(ctx.match[1]);
  if (!category || Number(category.is_active) !== 1) {
    await ctx.answerCbQuery('Kategoriya topilmadi');
    return;
  }
  await ctx.answerCbQuery();
  await ctx.editMessageText(`📂 ${category.title}\n\nXizmatni tanlang:`, { reply_markup: serviceListKeyboard(category.id).reply_markup });
});

bot.action(/^SVC_(\d+)$/, async (ctx) => {
  const service = findServiceById(ctx.match[1]);
  if (!service || Number(service.is_active) !== 1) {
    await ctx.answerCbQuery('Xizmat topilmadi');
    return;
  }
  const priceLine = service.type === SERVICE_TYPES.DYNAMIC_QUANTITY
    ? `💰 1000 tasi: ${formatPrice(service.price_per_1000)}\n🔢 Minimal: ${service.min_quantity || 1000} ta`
    : `💰 Narx: ${Number(service.price || 0) > 0 ? formatPrice(service.price) : 'Kelishiladi'}`;
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    [`📦 ${service.title}`, '', service.description || '', priceLine, `⏱ Muddat: ${service.delivery_time || 'Kelishiladi'}`].join('\n'),
    {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Buyurtma berish', `BUY_${service.id}`)],
        [Markup.button.callback('🔙 Orqaga', `CAT_${service.category_id}`)],
      ]).reply_markup,
    }
  );
});

bot.action(/^BUY_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter('ORDER_SCENE', { serviceId: Number(ctx.match[1]) });
});

bot.action('BACK_HOME', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🏠 Asosiy menyu', homeKeyboard(ctx));
});

bot.hears('📦 Buyurtmalarim', async (ctx) => {
  const orders = ensureTable('orders')
    .filter((o) => Number(o.user_id) === Number(ctx.from.id))
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, 10);
  if (!orders.length) return ctx.reply('Sizda hali buyurtmalar yo‘q.');
  let text = '📦 Oxirgi buyurtmalaringiz:\n\n';
  for (const o of orders) {
    text += `#${o.id} | ${o.service_title}\n💰 ${o.amount > 0 ? formatPrice(o.amount) : 'Kelishiladi'}\n🏷 ${o.status}\n📅 ${new Date(o.created_at).toLocaleString('uz-UZ')}\n\n`;
  }
  await ctx.reply(text);
});

bot.hears('💳 To‘lov usullari', async (ctx) => {
  await ctx.reply(paymentText());
});

bot.hears('📩 Admin', async (ctx) => {
  const username = cleanUsername(getSetting('support_username'));
  if (!username) return ctx.reply('Admin username hali sozlanmagan.');
  await ctx.reply(`📩 Admin bilan bog‘lanish: @${username}`, {
    reply_markup: Markup.inlineKeyboard([[Markup.button.url('Adminni ochish', `https://t.me/${username}`)]]).reply_markup,
  });
});

bot.hears('❓ Yordam', async (ctx) => ctx.reply(getSetting('faq_text')));
bot.hears('ℹ️ Bot haqida', async (ctx) => ctx.reply(getSetting('rules_text')));

bot.hears('📊 Statistika', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const orders = ensureTable('orders');
  const payments = ensureTable('payments');
  const revenue = orders.filter((o) => o.status === ORDER_STATUS.COMPLETED).reduce((s, o) => s + Number(o.amount || 0), 0);
  await ctx.reply([
    '📊 Bot statistikasi',
    '',
    `👥 Foydalanuvchilar: ${ensureTable('users').length}`,
    `📦 Buyurtmalar: ${orders.length}`,
    `🆕 Yangi: ${orders.filter((o) => o.status === ORDER_STATUS.NEW).length}`,
    `💳 To‘lov tekshiruvda: ${orders.filter((o) => o.status === ORDER_STATUS.PENDING_VERIFY).length}`,
    `🚀 Jarayonda: ${orders.filter((o) => o.status === ORDER_STATUS.PROCESSING).length}`,
    `✅ Bajarilgan: ${orders.filter((o) => o.status === ORDER_STATUS.COMPLETED).length}`,
    `❌ Bekor: ${orders.filter((o) => o.status === ORDER_STATUS.CANCELED).length}`,
    '',
    `💰 To‘lovlar: ${payments.length}`,
    `💵 Daromad: ${formatPrice(revenue)}`,
  ].join('\n'), adminMainKeyboard());
});

bot.hears('🤖 Bot holati', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply([
    '🤖 Bot holati yangilandi',
    '',
    `✅ Bot ishlayapti`,
    `👨‍💼 Adminlar: ${ADMIN_IDS.length}`,
    `📁 Data: ${DATA_PATH}`,
    `🕒 Vaqt: ${new Date().toLocaleString('uz-UZ')}`,
  ].join('\n'), adminMainKeyboard());
});

bot.hears('📦 Buyurtmalar', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const orders = ensureTable('orders').sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 15);
  if (!orders.length) return ctx.reply('Buyurtmalar yo‘q.', adminMainKeyboard());
  for (const o of orders) {
    const user = findUserByTelegramId(o.user_id);
    await ctx.reply([
      `🆔 Buyurtma #${o.id}`,
      `👤 Mijoz: ${user?.first_name || 'User'}${user?.username ? ` (@${user.username})` : ''}`,
      `📦 Xizmat: ${o.service_title}`,
      `💰 Summa: ${o.amount > 0 ? formatPrice(o.amount) : 'Kelishiladi'}`,
      `🏷 Holat: ${o.status}`,
      `📅 Sana: ${new Date(o.created_at).toLocaleString('uz-UZ')}`,
      '',
      '📝 Tafsilotlar:',
      formatDetails(o.details),
    ].join('\n'), { reply_markup: orderAdminKeyboard(o.id).reply_markup });
  }
});

bot.hears('💰 To‘lovlar', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const payments = ensureTable('payments').filter((p) => p.status === PAYMENT_STATUS.PENDING).sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 15);
  if (!payments.length) return ctx.reply('Kutilayotgan to‘lovlar yo‘q.', adminMainKeyboard());
  for (const p of payments) {
    const o = findOrderById(p.order_id);
    const caption = `💰 To‘lov tekshiruvi\n\nBuyurtma: #${p.order_id}\nXizmat: ${o?.service_title || '-'}\nSumma: ${formatPrice(p.amount)}\nUsul: ${p.method}\nSana: ${new Date(p.created_at).toLocaleString('uz-UZ')}`;
    try {
      await ctx.replyWithPhoto(p.receipt_file_id, { caption, reply_markup: orderAdminKeyboard(p.order_id).reply_markup });
    } catch {
      await ctx.reply(caption, { reply_markup: orderAdminKeyboard(p.order_id).reply_markup });
    }
  }
});

bot.hears('📣 Xabar yuborish', async (ctx) => {
  if (!isAdmin(ctx)) return;
  return ctx.scene.enter('BROADCAST_SCENE');
});

bot.hears('🗂 Kategoriyalar', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const cats = ensureTable('categories').sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
  const text = cats.length
    ? `🗂 Kategoriyalar:\n\n${cats.map((c) => `#${c.id} | ${c.sort_order}. ${c.title} ${Number(c.is_active) === 1 ? '✅' : '❌'}`).join('\n')}`
    : 'Kategoriya yo‘q.';
  await ctx.reply(text, { reply_markup: categoryAdminKeyboard().reply_markup });
});

bot.hears('🛠 Xizmatlar', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const services = ensureTable('services').sort((a, b) => Number(a.id) - Number(b.id));
  let text = '🛠 Xizmatlar:\n\n';
  for (const s of services) {
    text += `#${s.id} | ${s.button_title || s.title} ${Number(s.is_active) === 1 ? '✅' : '❌'}\n`;
    text += `📂 Kategoriya ID: ${s.category_id}\n`;
    text += `Type: ${s.type || SERVICE_TYPES.STANDARD}\n`;
    text += `Narx: ${Number(s.price || 0) > 0 ? formatPrice(s.price) : '-'} | 1000: ${Number(s.price_per_1000 || 0) > 0 ? formatPrice(s.price_per_1000) : '-'}\n\n`;
  }
  await ctx.reply(text || 'Xizmat yo‘q.', { reply_markup: serviceAdminKeyboard().reply_markup });
});

bot.hears('🧾 To‘lov usullari', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const methods = ensureTable('payment_methods');
  const text = methods.length
    ? `🧾 To‘lov usullari:\n\n${methods.map((m) => `#${m.id} | ${m.title} ${Number(m.is_active) === 1 ? '✅' : '❌'}\n${m.details}`).join('\n\n')}`
    : 'To‘lov usuli yo‘q.';
  await ctx.reply(text, { reply_markup: paymentAdminKeyboard().reply_markup });
});

bot.hears('⚙️ Sozlamalar', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const channels = await getForceJoinChannels();
  await ctx.reply([
    '⚙️ Sozlamalar',
    '',
    `Majburiy obuna: ${getSetting('force_join_enabled', false) ? 'Yoqilgan' : 'O‘chirilgan'}`,
    `Kanallar: ${channels.length}`,
    `Admin: @${cleanUsername(getSetting('support_username')) || '-'}`,
  ].join('\n'), { reply_markup: settingsKeyboard().reply_markup });
});

const editMap = {
  ADM_CAT_ADD: 'cat_add', ADM_CAT_UPDATE: 'cat_update', ADM_CAT_DELETE: 'cat_delete', ADM_CAT_TOGGLE: 'cat_toggle',
  ADM_SVC_ADD: 'svc_add', ADM_SVC_UPDATE: 'svc_update', ADM_SVC_DELETE: 'svc_delete', ADM_SVC_TOGGLE: 'svc_toggle',
  ADM_PAY_ADD: 'pay_add', ADM_PAY_UPDATE: 'pay_update', ADM_PAY_DELETE: 'pay_delete', ADM_PAY_TOGGLE: 'pay_toggle',
  SET_WELCOME: 'welcome', SET_FAQ: 'faq', SET_RULES: 'rules', SET_SUPPORT: 'support', SET_CHANNEL_ADD: 'channel_add', SET_CHANNEL_DELETE: 'channel_delete',
};

for (const [action, mode] of Object.entries(editMap)) {
  bot.action(action, async (ctx) => {
    if (!isAdmin(ctx)) return;
    await ctx.answerCbQuery();
    return ctx.scene.enter('ADMIN_EDIT_SCENE', { mode });
  });
}

bot.action('SET_FORCE_TOGGLE', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const next = !Boolean(getSetting('force_join_enabled', false));
  await setSetting('force_join_enabled', next);
  await ctx.answerCbQuery(next ? 'Yoqildi' : 'O‘chirildi');
  await ctx.reply(`Majburiy obuna: ${next ? 'Yoqildi' : 'O‘chirildi'}`, { reply_markup: settingsKeyboard().reply_markup });
});

bot.action('SET_CHANNEL_LIST', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const channels = await getForceJoinChannels();
  await ctx.answerCbQuery();
  await ctx.reply(channels.length ? `📢 Kanallar:\n\n${channels.map((c, i) => `${i + 1}. @${cleanUsername(c.username)}`).join('\n')}` : 'Kanal yo‘q.');
});

bot.action(/^APPROVE_PAY_(\d+)$/, async (ctx) => updateOrderStatus(ctx, Number(ctx.match[1]), ORDER_STATUS.CONFIRMED, PAYMENT_STATUS.APPROVED, '✅ To‘lov tasdiqlandi. Buyurtmangiz ishga olinadi.'));
bot.action(/^REJECT_PAY_(\d+)$/, async (ctx) => updateOrderStatus(ctx, Number(ctx.match[1]), ORDER_STATUS.NEW, PAYMENT_STATUS.REJECTED, '❌ To‘lov rad etildi. Iltimos, admin bilan bog‘laning.'));
bot.action(/^START_WORK_(\d+)$/, async (ctx) => updateOrderStatus(ctx, Number(ctx.match[1]), ORDER_STATUS.PROCESSING, null, '🚀 Buyurtmangiz jarayonga olindi.'));
bot.action(/^COMPLETE_ORDER_(\d+)$/, async (ctx) => updateOrderStatus(ctx, Number(ctx.match[1]), ORDER_STATUS.COMPLETED, null, '✅ Buyurtmangiz bajarildi. Rahmat!'));
bot.action(/^CANCEL_ORDER_(\d+)$/, async (ctx) => updateOrderStatus(ctx, Number(ctx.match[1]), ORDER_STATUS.CANCELED, null, '❌ Buyurtmangiz bekor qilindi.'));

async function updateOrderStatus(ctx, orderId, orderStatus, paymentStatus, userMessage) {
  if (!isAdmin(ctx)) return;
  const order = findOrderById(orderId);
  if (!order) return ctx.answerCbQuery('Buyurtma topilmadi');
  const payment = findPaymentByOrderId(orderId);
  order.status = orderStatus;
  order.updated_at = nowIso();
  if (payment && paymentStatus) payment.status = paymentStatus;
  await saveData();
  await logAction('ORDER_STATUS', `order_id=${orderId}; status=${orderStatus}`);
  await ctx.answerCbQuery('Bajarildi');
  try { await ctx.telegram.sendMessage(order.user_id, `${userMessage}\n\nBuyurtma ID: #${orderId}`); } catch {}
}

bot.hears(/.*/, async (ctx) => {
  if (ctx.chat?.type !== 'private') return;
  if (isAdmin(ctx)) return ctx.reply('🛠 Admin paneldan kerakli bo‘limni tanlang.', adminMainKeyboard());
  return ctx.reply('Kerakli bo‘limni menyudan tanlang 👇', userMainKeyboard());
});

bot.catch((err, ctx) => {
  console.error(`BOT ERROR [${ctx.updateType}]`, err);
  ctx.reply('Xatolik yuz berdi. Iltimos, qaytadan urinib ko‘ring.').catch(() => {});
});

async function main() {
  await loadData();
  await seedInitialData();
  await bot.launch();
  console.log('✅ Bot ishga tushdi');
  console.log('👨‍💼 ADMIN_IDS:', ADMIN_IDS);
  console.log('📁 DATA_PATH:', DATA_PATH);
}

main().catch((err) => {
  console.error('START ERROR:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
