const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const fs = require('fs');

const BOT_TOKEN = '9124366756:AAH5fAq5hfEbmBujc22a7oM59h6SMBVBmw0';
const bot = new Telegraf(BOT_TOKEN);

// Простая база данных в памяти (при перезапуске сбросится)
let savedBusinesses = [];

const BLACKLIST = ["пятерочка", "магнит", "перекресток", "дикси", "лента", "ашан", "вкусвилл", "fix price", "wildberries", "ozon"];

async function findBusinesses(city) {
    try {
        // 1. Ищем координаты города
        const geo = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, {
            headers: { 'User-Agent': 'PivoBot/1.0' }
        });
        if (!geo.data.length) return [];

        const lat = geo.data[0].lat;
        const lon = geo.data[0].lon;

        // 2. Ищем кафе в радиусе 5 км
        const query = `[out:json];node["amenity"="cafe"](around:5000,${lat},${lon});out;`;
        const res = await axios.post('https://overpass-api.de/api/interpreter', `data=${encodeURIComponent(query)}`, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        let businesses = [];
        for (let el of res.data.elements) {
            const tags = el.tags || {};
            const name = tags.name;
            const phone = tags.phone || tags['contact:phone'];
            const website = tags.website;

            if (name && phone && !website) {
                const lower = name.toLowerCase();
                if (!BLACKLIST.some(w => lower.includes(w))) {
                    businesses.push({
                        name: name,
                        address: tags['addr:street'] ? `${tags['addr:street']}, ${tags['addr:housenumber'] || ''}` : "Адрес уточняется",
                        phone: phone
                    });
                }
            }
        }
        return businesses;
    } catch (e) {
        console.log("Ошибка парсинга:", e.message);
        return [];
    }
}

const greeting = `Здравствуйте! Меня зовут [Имя]. Я занимаюсь разработкой современных сайтов. Подскажите, вы задумывались о том, чтобы сделать сайт для вашего заведения?`;

bot.start((ctx) => {
    ctx.reply("Здравствуйте, добро пожаловать в PivoShop", Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Искать', 'search')],
        [Markup.button.callback('📊 Статистика', 'stats')]
    ]));
});

bot.action('search', async (ctx) => {
    ctx.answerCbQuery('Ищу...');
    const msg = await ctx.reply('⏳ Ищу бизнесы без сайтов...');
    
    const results = await findBusinesses("Москва");
    
    if (results.length === 0) {
        return ctx.editMessageText("😔 Не найдено.");
    }

    // Берем первый попавшийся
    const biz = results[Math.floor(Math.random() * results.length)];

    const text = `🏢 *${biz.name}*\n\n📍 ${biz.address}\n📞 ${biz.phone}\n\n💬 *Приветствие:*\n_${greeting}_`;

    await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('➕ В работу', `save:${biz.name}`), Markup.button.callback('➖ Пропустить', 'search')]
        ])
    });
    
    ctx.deleteMessage(msg.message_id);
});

bot.action(/^save:(.+)$/, (ctx) => {
    const bizName = ctx.match[1];
    // Тут мы просто сохраняем в память
    if (!savedBusinesses.find(b => b.name === bizName)) {
        savedBusinesses.push({ name: bizName, status: "В работе" });
    }
    ctx.answerCbQuery('✅ Сохранено!');
    bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'search' } });
});

bot.action('stats', (ctx) => {
    if (!savedBusinesses.length) return ctx.reply("Статистика пуста.");
    
    let text = `📊 *В работе (${savedBusinesses.length}):*\n\n`;
    savedBusinesses.forEach((b, i) => {
        text += `${i + 1}. *${b.name}*\n`;
    });
    ctx.reply(text, { parse_mode: 'Markdown' });
});

bot.launch();
console.log('PivoShop bot up');
