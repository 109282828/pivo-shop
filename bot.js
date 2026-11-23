const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = '9124366756:AAH5fAq5hfEbmBujc22a7oM59h6SMBVBmw0';
const bot = new Telegraf(BOT_TOKEN);

let savedBusinesses = [];
let reminders = [];
let currentResults = [];
let currentIndex = 0;
let seenBusinesses = [];
const awaiting = {};

const BLACKLIST = ["пятерочка", "магнит", "перекресток", "дикси", "лента", "ашан", "вкусвилл", "fix price", "wildberries", "ozon"];

async function findBusinesses(city) {
    try {
        const searchUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(city + ' кафе')}`;
        
        const res = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ru-RU,ru;q=0.9'
            }
        });

        const html = res.data;
        
        // Проверка на капчу (Яндекс часто выдает "Вы не робот?")
        if (html.includes('Вы не робот') || html.includes('captcha')) {
            return { error: "Яндекс выдал капчу" };
        }

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
                        if (!businesses.find(b => b.name === name)) {
                            businesses.push({ name: name, address: address, phone: phone });
                        }
                    }
                }
            } catch (e) {}
        }
        return { data: businesses };
    } catch (e) {
        return { error: "Ошибка сети" };
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

    if (currentResults.length === 0 || currentIndex >= currentResults.length) {
        const msg = await ctx.reply('⏳ Ищу новые бизнесы...');
        
        const result = await findBusinesses("Москва");
        
        // Если парсер вернул ошибку или пустоту
        if (result.error || !result.data || result.data.length === 0) {
            try { await ctx.deleteMessage(msg.message_id); } catch(e) {}
            return ctx.reply("😔 Яндекс временно заблокировал запрос или ничего не нашел. Подожди 10-15 секунд и нажми «Искать» снова.", getMainMenu());
        }

        currentResults = result.data;
        currentIndex = 0;
        try { await ctx.deleteMessage(msg.message_id); } catch(e) {}
    }

    const biz = currentResults[currentIndex];
    currentIndex++;
    seenBusinesses.push(biz.name);

    const text = `🏢 *${biz.name}*\n\n📍 Город: *Москва*\n📍 Адрес: ${biz.address}\n📞 Телефон: ${biz.phone}\n\n💬 *Приветствие:*\n_${greeting}_\n\n📝 *Если согласились:*\n_${followUp}_`;

    await ctx.reply(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('➕ В работу', `ask_time:${biz.name}`), Markup.button.callback('➖ Пропустить', 'search')]
        ])
    });
});

// ... (Остальной код (ask_time, on text, stats, reminders, setInterval) оставь тот же) ...
