const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = '9124366756:AAH5fAq5hfEbmBujc22a7oM59h6SMBVBmw0';
const bot = new Telegraf(BOT_TOKEN);

let currentResults = [];
let currentIndex = 0;

const CITIES = [
    "Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", 
    "Нижний Новгород", "Челябинск", "Самара", "Омск", "Ростов-на-Дону"
];

async function findBusinessesYandex(city) {
    try {
        const searchUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(city + ' кафе')}`;
        const res = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ru-RU,ru;q=0.9'
            },
            timeout: 4000
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
            if (org.phones && !org.urls) {
                businesses.push({ 
                    name: org.name, 
                    address: org.address || "Адрес уточняется", 
                    phone: org.phones[0].number 
                });
            }
        }
        return businesses.length > 0 ? { city, data: businesses } : null;
    } catch (e) {
        return null;
    }
}

async function findFastestBusiness() {
    const shuffled = [...CITIES].sort(() => 0.5 - Math.random());
    const citiesToTry = shuffled.slice(0, 5);
    const promises = citiesToTry.map(city => findBusinessesYandex(city));
    const results = await Promise.all(promises);
    
    for (let result of results) {
        if (result && result.data.length > 0) return result;
    }
    return null;
}

bot.start((ctx) => {
    ctx.reply("Добро пожаловать в PivoShop!", Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Искать', 'search')]
    ]));
});

bot.action('search', async (ctx) => {
    try { await ctx.deleteMessage(); } catch(e) {}
    
    const msg = await ctx.reply('⏳ Ищу...');
    const result = await findFastestBusiness();
    
    if (!result) {
        return ctx.editMessageText("😔 Не найдено. Нажми еще раз.");
    }

    currentResults = result.data;
    currentIndex = 0;
    
    ctx.deleteMessage(msg.message_id);
    
    const biz = currentResults[0];
    currentIndex++;

    const text = `🏢 *${biz.name}*\n\n📍 Город: *${result.city}*\n📍 Адрес: ${biz.address}\n📞 Телефон: ${biz.phone}`;

    await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('➖ Пропустить', 'search')]
        ])
    });
});

bot.launch();
console.log('PivoShop bot up');
