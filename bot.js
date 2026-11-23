const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = '9124366756:AAH5fAq5hfEbmBujc22a7oM59h6SMBVBmw0';
const bot = new Telegraf(BOT_TOKEN);

let savedBusinesses = [];
let currentResults = [];
let currentIndex = 0;
let seenBusinesses = [];
let currentCity = "";
const awaiting = {};

const CITIES = [
    "Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", 
    "Нижний Новгород", "Челябинск", "Самара", "Омск", "Ростов-на-Дону", 
    "Уфа", "Красноярск", "Воронеж", "Пермь", "Волгоград", "Краснодар"
];

const BLACKLIST = ["пятерочка", "магнит", "перекресток", "дикси", "лента", "ашан", "вкусвилл", "fix price", "wildberries", "ozon"];

// 1. Попытка спарсить Яндекс
async function findBusinessesYandex(city) {
    try {
        const searchUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(city + ' кафе')}`;
        const res = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ru-RU,ru;q=0.9'
            },
            timeout: 8000
        });

        const html = res.data;
        if (html.includes('Вы не робот') || html.includes('captcha')) return { error: "Капча" };

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

                    if (phone && !hasWebsite && !seenBusinesses.includes(name)) {
                        businesses.push({ name, address, phone });
                    }
                }
            } catch (e) {}
        }
        return { data: businesses };
    } catch (e) {
        return { error: "Сеть" };
    }
}

// 2. Страховка через OSM
async function findBusinessesOSM(city) {
    try {
        const geo = await axios.get(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, {
            headers: { 'User-Agent': 'PivoBot/1.0' }
        });
        if (!geo.data.length) return [];

        const lat = geo.data[0].lat;
        const lon = geo.data[0].lon;

        const query = `
            [out:json][timeout:25];
            (
              node["amenity"~"cafe|restaurant|fast_food|dentist|bar|pub"](around:10000,${lat},${lon});
              node["leisure"~"fitness_centre|sports_centre"](around:10000,${lat},${lon});
              node["shop"](around:10000,${lat},${lon});
            );
            out body;
        `;
        const overpassRes = await axios.post('https://overpass-api.de/api/interpreter', `data=${encodeURIComponent(query)}`, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        let businesses = [];
        for (let el of overpassRes.data.elements) {
            const tags = el.tags || {};
            const name = tags.name;
            const phone = tags.phone || tags['contact:phone'];
            const website = tags.website || tags['contact:website'];

            if (name && phone && !website && !seenBusinesses.includes(name)) {
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
        return [];
    }
}

const greeting = `Здравствуйте! Меня зовут [Имя]. Я занимаюсь разработкой современных сайтов. Подскажите, вы задумывались о том, чтобы сделать сайт для вашего заведения?`;

function getMainMenu() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Искать', 'search')],
        [Markup.button.callback('📊 Статистика', 'stats')]
    ]);
}

bot.start((ctx) => {
    ctx.reply("Здравствуйте, добро пожаловать в PivoShop!", getMainMenu());
});

bot.action('search', async (ctx) => {
    try { await ctx.deleteMessage(); } catch(e) {}

    if (currentResults.length === 0 || currentIndex >= currentResults.length) {
        currentCity = CITIES[Math.floor(Math.random() * CITIES.length)];
        
        const msg = await ctx.reply(`⏳ Ищу бизнесы в *${currentCity}*...`, { parse_mode: 'Markdown' });
        
        // Сначала пробуем Яндекс
        let result = await findBusinessesYandex(currentCity);
        let source = "Яндекс";
        
        // Если Яндекс выдал капчу или пустоту, берем OSM
        if (result.error || !result.data || result.data.length === 0) {
            result = { data: await findBusinessesOSM(currentCity) };
            source = "OpenStreetMap";
        }

        if (!result.data || result.data.length === 0) {
            try { await ctx.deleteMessage(msg.message_id); } catch(e) {}
            return ctx.reply(`😔 В городе ${currentCity} ничего не найдено. Нажми еще раз.`, getMainMenu());
        }

        currentResults = result.data;
        currentIndex = 0;
        
        try { await ctx.deleteMessage(msg.message_id); } catch(e) {}
        ctx.reply(`✅ Найдено через ${source}. Выдаю...`);
    }

    const biz = currentResults[currentIndex];
    currentIndex++;
    seenBusinesses.push(biz.name);

    const text = `🏢 *${biz.name}*\n\n📍 Город: *${currentCity}*\n📍 Адрес: ${biz.address}\n📞 Телефон: ${biz.phone}\n\n💬 *Приветствие:*\n_${greeting}_`;

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

bot.action('back', (ctx) => {
    ctx.reply("Главное меню", getMainMenu());
});

setInterval(() => {
    const now = Date.now();
    savedBusinesses = savedBusinesses.filter(r => {
        // Тут можно добавить логику напоминаний, если нужно
        return true;
    });
}, 60000);

bot.launch();
console.log('PivoShop bot up');
