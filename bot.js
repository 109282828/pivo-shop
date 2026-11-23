const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = '9124366756:AAH5fAq5hfEbmBujc22a7oM59h6SMBVBmw0';
const bot = new Telegraf(BOT_TOKEN);

let savedBusinesses = [];
let reminders = [];
let currentResults = [];
let currentIndex = 0;
let seenBusinesses = []; // Список тех, кого уже показали
const awaiting = {};

const BLACKLIST = ["пятерочка", "магнит", "перекресток", "дикси", "лента", "ашан", "вкусвилл", "fix price", "wildberries", "ozon"];

async function findBusinesses(city) {
    try {
        const searchUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(city + ' кафе стоматология спортзал')}`;
        
        const res = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ru-RU,ru;q=0.9'
            }
        });

        const html = res.data;
        const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/);
        
        let businesses = [];

        if (jsonMatch) {
            try {
                const state = JSON.parse(jsonMatch[1]);
                let orgs = [];

                function findOrgs(obj) {
                    if (!obj || typeof obj !== 'object') return;
                    if (obj.name && (obj.phones || obj.phone)) orgs.push(obj);
                    for (let key in obj) {
                        if (typeof obj[key] === 'object') findOrgs(obj[key]);
                    }
                }
                findOrgs(state);

                for (let org of orgs) {
                    const name = org.name;
                    const lower = name.toLowerCase();
                    if (BLACKLIST.some(w => lower.includes(w))) continue;

                    let phone = org.phones ? org.phones[0].number : null;
                    let address = org.address || "Адрес уточняется";
                    let hasWebsite = org.urls && org.urls.length > 0;

                    // Если есть телефон, нет сайта и мы его еще не видели
                    if (phone && !hasWebsite && !seenBusinesses.includes(name)) {
                        if (!businesses.find(b => b.name === name)) {
                            businesses.push({ name: name, address: address, phone: phone });
                        }
                    }
                }
            } catch (e) {}
        }
        return businesses;
    } catch (e) {
        return [];
    }
}

const greeting = `Здравствуйте! Меня зовут [Имя]. Я занимаюсь разработкой современных сайтов. Подскажите, вы задумывались о том, чтобы сделать сайт для вашего заведения?`;
const followUp = `Отлично! Тогда я могу подготовить для вас пару вариантов дизайна бесплатно. Когда вам удобно созвониться?`;

function getMainMenu() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Искать', 'search')],
        [Markup.button.callback('📊 Статистика', 'stats')],
        [Markup.button.callback('⏰ Напоминания', 'reminders')]
    ]);
}

bot.start((ctx) => {
    ctx.reply("Здравствуйте, добро пожаловать в PivoShop", getMainMenu());
});

bot.action('back', (ctx) => {
    ctx.reply("Главное меню", getMainMenu());
});

bot.action('search', async (ctx) => {
    try { await ctx.deleteMessage(); } catch(e) {}

    // Если список пуст или все из него уже просмотрены
    if (currentResults.length === 0 || currentIndex >= currentResults.length) {
        const msg = await ctx.reply('⏳ Ищу новые бизнесы...');
        
        // Запрашиваем новую пачку
        currentResults = await findBusinesses("Москва");
        currentIndex = 0;

        // Если после фильтрации ничего не осталось
        if (currentResults.length === 0) {
            return ctx.editMessageText("😔 Новых бизнесов не найдено. Все, кого нашли, уже в работе или пропущены.");
        }
        try { await ctx.deleteMessage(msg.message_id); } catch(e) {}
    }

    const biz = currentResults[currentIndex];
    currentIndex++;
    
    // Запоминаем, что показали
    seenBusinesses.push(biz.name);

    const text = `🏢 *${biz.name}*\n\n📍 Город: *Москва*\n📍 Адрес: ${biz.address}\n📞 Телефон: ${biz.phone}\n\n💬 *Приветствие:*\n_${greeting}_\n\n📝 *Если согласились:*\n_${followUp}_`;

    await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('➕ В работу', `ask_time:${biz.name}`), Markup.button.callback('➖ Пропустить', 'search')]
        ])
    });
});

bot.action(/^ask_time:(.+)$/, async (ctx) => {
    try { await ctx.deleteMessage(); } catch(e) {}
    const bizName = ctx.match[1];
    awaiting[ctx.from.id] = { type: 'await_time', bizName: bizName };
    ctx.reply(`Когда перезвонить в *${bizName}*?\n\nНапишите дату и время в формате:\n\`2026-11-25 15:30\``, { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx) => {
    const s = awaiting[ctx.from.id];
    if (s && s.type === 'await_time') {
        const timeText = ctx.message.text;
        const reminderTime = new Date(timeText).getTime();
        
        if (isNaN(reminderTime)) {
            return ctx.reply("❌ Неверный формат. Напиши так: `2026-11-25 15:30`", { parse_mode: 'Markdown' });
        }

        if (!savedBusinesses.find(b => b.name === s.bizName)) {
            savedBusinesses.push({ name: s.bizName, status: `Напомнить: ${timeText}` });
        }

        reminders.push({ chatId: ctx.chat.id, bizName: s.bizName, time: reminderTime });
        delete awaiting[ctx.from.id];

        try { await ctx.deleteMessage(); } catch(e) {}
        ctx.reply(`✅ Напоминание для *${s.bizName}* установлено.`);
        
        bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'search' } });
    }
});

bot.action('stats', async (ctx) => {
    try { await ctx.deleteMessage(); } catch(e) {}
    if (!savedBusinesses.length) return ctx.reply("Статистика пуста.", getMainMenu());
    
    let text = `📊 *В работе (${savedBusinesses.length}):*\n\n`;
    savedBusinesses.forEach((b, i) => text += `${i + 1}. *${b.name}* (${b.status})\n`);
    
    ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'back')]]) });
});

bot.action('reminders', async (ctx) => {
    try { await ctx.deleteMessage(); } catch(e) {}
    if (!reminders.length) return ctx.reply("Напоминаний нет.", getMainMenu());
    
    let text = `⏰ *Твои напоминания:*\n\n`;
    reminders.forEach((r, i) => {
        const date = new Date(r.time).toLocaleString('ru-RU');
        text += `${i + 1}. *${r.bizName}*\n🕒 ${date}\n\n`;
    });
    ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'back')]]) });
});

setInterval(() => {
    const now = Date.now();
    reminders = reminders.filter(r => {
        if (now >= r.time && now < r.time + 60000) {
            bot.telegram.sendMessage(r.chatId, `🔔 *НАПОМИНАНИЕ!*\n\nПора перезвонить в *${r.bizName}*!`, { parse_mode: 'Markdown' });
            return false;
        }
        return true;
    });
}, 60000);

bot.launch();
console.log('PivoShop bot up');
