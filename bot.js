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
    "Уфа", "Красноярск", "Воронеж", "Пермь", "Волгоград", "Краснодар",
    "Саратов", "Тюмень", "Тольятти", "Ижевск", "Барнаул", "Ульяновск",
    "Иркутск", "Хабаровск", "Ярославль", "Владивосток", "Махачкала"
];

const BLACKLIST = ["пятерочка", "магнит", "перекресток", "дикси", "лента", "ашан", "вкусвилл", "fix price"];

// Быстрый парсинг Яндекса для одного города
async function findBusinessesYandex(city) {
    try {
        const searchUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(city + ' кафе')}`;
        const res = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ru-RU,ru;q=0.9'
            },
            timeout: 4000 // Ждем не больше 4 секунд
        });

        const html = res.data;
        if (html.includes('Вы не робот') || html.includes('captcha')) return null;

        const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/);
        if (!jsonMatch) return null;

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

        let businesses = [];
        for (let org of orgs) {
            const name = org.name;
            if (BLACKLIST.some(w => name.toLowerCase().includes(w))) continue;
            
            if (org.phones && !org.urls && !seenBusinesses.includes(name)) {
                businesses.push({ name, address: org.address || "Адрес уточняется", phone: org.phones[0].number });
            }
        }
        return businesses.length > 0 ? { city, data: businesses } : null;
    } catch (e) {
        return null;
    }
}

// Параллельный поиск в 5 городах одновременно
async function findFastestBusiness() {
    // Выбираем 5 случайных городов
    const shuffled = [...CITIES].sort(() => 0.5 - Math.random());
    const citiesToTry = shuffled.slice(0, 5);

    // Запускаем 5 запросов одновременно
    const promises = citiesToTry.map(city => findBusinessesYandex(city));
    
    // Ждем, пока хотя бы один вернет результат
    const results = await Promise.all(promises);
    
    // Берем первый успешный результат
    for (let result of results) {
        if (result && result.data.length > 0) {
            return result;
        }
    }
    return null;
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
        const msg = await ctx.reply(`⏳ Ищу бизнесы (параллельный поиск)...`);
        
        const start = Date.now();
        const result = await findFastestBusiness();
        const timeTaken = ((Date.now() - start) / 1000).toFixed(1);

        if (!result) {
            try { await ctx.deleteMessage(msg.message_id); } catch(e) {}
            return ctx.reply(`😔 Ничего не найдено (за ${timeTaken} сек). Нажми еще раз.`, getMainMenu());
        }

        currentCity = result.city;
        currentResults = result.data;
        currentIndex = 0;
        
        try { await ctx.deleteMessage(msg.message_id); } catch(e) {}
        ctx.reply(`✅ Найдено в *${currentCity}* (за ${timeTaken} сек).`, { parse_mode: 'Markdown' });
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

// ... (Остальной код ask_time, on text, stats и back оставляй как было) ...
