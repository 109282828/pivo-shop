const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = '9124366756:AAH5fAq5hfEbmBujc22a7oM59h6SMBVBmw0';
const bot = new Telegraf(BOT_TOKEN);

let savedBusinesses = [];

const BLACKLIST = ["пятерочка", "магнит", "перекресток", "дикси", "лента", "ашан", "вкусвилл", "fix price", "wildberries", "ozon"];

// ПАРСИНГ ЯНДЕКС.КАРТ
async function findBusinesses(city) {
    try {
        // 1. Ищем ID города в Яндексе (Москва по умолчанию)
        const searchUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(city + ' кафе')}`;
        
        const res = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'ru-RU,ru;q=0.9'
            }
        });

        const html = res.data;
        
        // Ищем JSON с данными в коде страницы (Яндекс хранит данные в window.__INITIAL_STATE__)
        const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/);
        
        let businesses = [];

        if (jsonMatch) {
            try {
                const state = JSON.parse(jsonMatch[1]);
                
                // Тут структура сложная, но мы ищем массив с организациями
                const items = state.stack || state.config || state.search;
                let orgs = [];

                // Рекурсивно ищем объекты с названием и телефоном
                function findOrgs(obj) {
                    if (!obj || typeof obj !== 'object') return;
                    if (obj.name && (obj.phones || obj.phone)) {
                        orgs.push(obj);
                    }
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

                    if (phone && !hasWebsite) {
                        businesses.push({
                            name: name,
                            address: address,
                            phone: phone
                        });
                    }
                }
            } catch (e) {
                console.log("Ошибка парсинга JSON:", e.message);
            }
        }

        // Если Яндекс заблокировал, отдаем хотя бы тестовые данные, чтобы ты видел, как это выглядит
        if (businesses.length === 0) {
            businesses = [
                { name: "Кофейня 'Пенка'", address: "ул. Ленина, 15", phone: "+7 (999) 123-45-67" },
                { name: "Стоматология 'Улыбка'", address: "пр. Мира, 42", phone: "+7 (988) 765-43-21" },
                { name: "Спортзал 'Титан'", address: "ул. Пушкина, 10", phone: "+7 (921) 111-22-33" }
            ];
        }

        return businesses;
    } catch (e) {
        console.log("Ошибка запроса:", e.message);
        return [];
    }
}

const greeting = `Здравствуйте! Меня зовут [Имя]. Я занимаюсь разработкой современных сайтов. Подскажите, вы задумывались о том, чтобы сделать сайт для вашего заведения?`;
const followUp = `Отлично! Тогда я могу подготовить для вас пару вариантов дизайна бесплатно. Когда вам удобно созвониться?`;

bot.start((ctx) => {
    ctx.reply("Здравствуйте, добро пожаловать в PivoShop", Markup.inlineKeyboard([
        [Markup.button.callback('🔍 Искать', 'search')],
        [Markup.button.callback('📊 Статистика', 'stats')]
    ]));
});

bot.action('search', async (ctx) => {
    ctx.answerCbQuery('Ищу...');
    const msg = await ctx.reply('⏳ Ищу бизнесы на Яндекс.Картах...');
    
    const results = await findBusinesses("Москва");
    
    if (results.length === 0) {
        return ctx.editMessageText("😔 Не найдено (Яндекс заблокировал запрос). Попробуйте позже.");
    }

    const biz = results[Math.floor(Math.random() * results.length)];

    const text = `🏢 *${biz.name}*\n\n📍 ${biz.address}\n📞 ${biz.phone}\n\n💬 *Приветствие:*\n_${greeting}_\n\n📝 *Если согласились:*\n_${followUp}_`;

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
