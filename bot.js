const { Telegraf, Markup } = require('telegraf');
const db = require('./db');
const axios = require('axios');

const BOT_TOKEN = '9124366756:AAH5fAq5hfEbmBujc22a7oM59h6SMBVBmw0';

const bot = new Telegraf(BOT_TOKEN);
let searchResults = [];
let currentIndex = 0;
const awaiting = {}; 

const BLACKLIST = ["пятерочка", "магнит", "перекресток", "дикси", "лента", "ашан", "вкусвилл", "fix price", "wildberries", "ozon"];

// Поиск (без изменений)
async function findBusinesses(city) {
    try {
        const geoRes = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, {
            headers: { 'User-Agent': 'PivoShopBot/1.0' }
        });
        
        if (!geoRes.data || geoRes.data.length === 0) return [];
        const lat = geoRes.data[0].lat;
        const lon = geoRes.data[0].lon;

        const query = `
            [out:json][timeout:30];
            (
              node["amenity"~"cafe|restaurant|fast_food|dentist|bar|pub|bureau"](around:5000,${lat},${lon});
              node["leisure"~"fitness_centre|sports_centre"](around:5000,${lat},${lon});
              node["shop"](around:5000,${lat},${lon});
            );
            out body;
        `;
        const overpassRes = await axios.post('https://overpass-api.de/api/interpreter', `data=${encodeURIComponent(query)}`, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const elements = overpassRes.data.elements;
        let businesses = [];

        for (let el of elements) {
            const tags = el.tags || {};
            const name = tags.name;
            const phone = tags.phone || tags['contact:phone'];
            const website = tags.website || tags['contact:website'];
            const street = tags['addr:street'];
            const house = tags['addr:housenumber'];

            if (!name || !phone || website) continue; 

            const lowerName = name.toLowerCase();
            if (BLACKLIST.some(word => lowerName.includes(word))) continue;

            if (tags.opening_hours === "closed") continue;

            businesses.push({
                name: name,
                address: street ? `${street}, ${house || ''}` : "Адрес уточняется",
                phone: phone,
                photo: `https://source.unsplash.com/400x300/?business,${encodeURIComponent(name)}`
            });
        }
        
        businesses.sort(() => Math.random() - 0.5);
        return businesses.slice(0, 20);
    } catch (e) {
        return [];
    }
}

const greeting = `Здравствуйте! Меня зовут [Имя]. Я занимаюсь разработкой современных сайтов. Подскажите, вы задумывались о том, чтобы сделать сайт для вашего заведения?`;
const followUp = `Отлично! Тогда я могу подготовить для вас пару вариантов дизайна бесплатно. Когда вам удобно созвониться?`;

bot.start((ctx) => {
    ctx.reply("Здравствуйте, добро пожаловать в PivoShop", Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Искать', 'search')],
        [Markup.button.callback('📊 Статистика', 'stats')],
        [Markup.button.callback('⏰ Напоминания', 'reminders')]
    ]));
});

bot.action('search', async (ctx) => {
    if (searchResults.length === 0 || currentIndex >= searchResults.length) {
        ctx.answerCbQuery('Ищу...');
        const msg = await ctx.reply('⏳ Ищу бизнесы без сайтов...');
        searchResults = await findBusinesses("Москва");
        currentIndex = 0;
        if (searchResults.length === 0) return ctx.editMessageText("😔 Не найдено.");
        ctx.deleteMessage(msg.message_id);
    }

    const biz = searchResults[currentIndex];
    currentIndex++;

    const text = `🏢 *${biz.name}*\n\n📍 ${biz.address}\n📞 ${biz.phone}\n\n💬 *Приветствие:*\n_${greeting}_\n\n📝 *Если согласились:*\n_${followUp}_`;

    try {
        await ctx.replyWithPhoto(biz.photo, {
            caption: text,
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('➕ В работу', `save_ask:${biz.name}`), Markup.button.callback('➖ Пропустить', 'search')]
            ])
        });
    } catch (e) {
        await ctx.reply(text, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('➕ В работу', `save_ask:${biz.name}`), Markup.button.callback('➖ Пропустить', 'search')]
            ])
        });
    }
});

bot.action(/^save_ask:(.+)$/, (ctx) => {
    const bizName = ctx.match[1];
    ctx.editMessageReplyMarkup(Markup.inlineKeyboard([
        [Markup.button.callback('✍️ Написать время', `set_time:${bizName}`), Markup.button.callback('✅ Уже согласны', `save_direct:${bizName}`)]
    ]).reply_markup);
});

bot.action(/^save_direct:(.+)$/, (ctx) => {
    const bizName = ctx.match[1];
    const biz = searchResults.find(b => b.name === bizName);
    if (biz) {
        db.addBusiness({ ...biz, status: "Согласны" });
        ctx.answerCbQuery('✅ Сохранено в статистику!');
    }
    bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'search' } });
});

bot.action(/^set_time:(.+)$/, (ctx) => {
    const bizName = ctx.match[1];
    awaiting[ctx.from.id] = { type: 'await_time', bizName: bizName };
    ctx.reply(`Напишите дату и время, когда нужно перезвонить.\nПример: \`2026-11-25 15:30\``, { parse_mode: 'Markdown' });
});

bot.on('text', async (ctx) => {
    const s = awaiting[ctx.from.id];
    if (s && s.type === 'await_time') {
        const timeText = ctx.message.text;
        const biz = searchResults.find(b => b.name === s.bizName);
        
        const reminderTime = new Date(timeText).getTime();
        
        if (isNaN(reminderTime)) {
            return ctx.reply("❌ Неверный формат времени. Напиши так: `2026-11-25 15:30`", { parse_mode: 'Markdown' });
        }

        if (biz) {
            const reminder = {
                id: Date.now().toString(),
                chatId: ctx.chat.id,
                bizName: biz.name,
                phone: biz.phone,
                time: reminderTime
            };
            db.addReminder(reminder);
            db.addBusiness({ ...biz, status: `Напомнить: ${timeText}` });
            
            delete awaiting[ctx.from.id];
            ctx.reply(`✅ Напоминание установлено на ${timeText}.\nПродолжаю поиск...`);
            bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'search' } });
        }
    }
});

bot.action('stats', (ctx) => {
    const list = db.getBusinesses();
    if (!list.length) return ctx.reply("Статистика пуста.", Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'back')]]));

    let text = `📊 *В работе (${list.length}):*\n\n`;
    list.forEach((b, i) => {
        text += `${i + 1}. *${b.name}* (${b.status || 'Ожидание'})\n📞 ${b.phone}\n\n`;
    });
    ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'back')]]) });
});

bot.action('reminders', (ctx) => {
    const list = db.getReminders();
    if (!list.length) return ctx.reply("Напоминаний нет.", Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'back')]]));

    let text = `⏰ *Твои напоминания:*\n\n`;
    list.forEach((r, i) => {
        const date = new Date(r.time).toLocaleString('ru-RU');
        text += `${i + 1}. *${r.bizName}* (${r.phone})\n🕒 ${date}\n\n`;
    });
    ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'back')]]) });
});

bot.action('back', (ctx) => {
    ctx.reply("Главное меню", Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Искать', 'search')],
        [Markup.button.callback('📊 Статистика', 'stats')],
        [Markup.button.callback('⏰ Напоминания', 'reminders')]
    ]));
});

// Проверка напоминаний раз в минуту
setInterval(() => {
    const now = Date.now();
    const reminders = db.getReminders();
    
    reminders.forEach(r => {
        if (now >= r.time && now < r.time + 60000) {
            bot.telegram.sendMessage(r.chatId, `🔔 *НАПОМИНАНИЕ!*\n\nПора перезвонить в *${r.bizName}*.\n📞 Номер: ${r.phone}`, { parse_mode: 'Markdown' });
            db.removeReminder(r.id);
        }
    });
}, 60000);

bot.launch();
console.log('PivoShop bot up');
