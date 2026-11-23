const { Telegraf, Markup } = require('telegraf');
const db = require('./db');
const axios = require('axios');

const BOT_TOKEN = '9124366756:AAH5fAq5hfEbmBujc22a7oM59h6SMBVBmw0';

const bot = new Telegraf(BOT_TOKEN);
let searchResults = [];
let currentIndex = 0;
const awaiting = {}; 

const BLACKLIST = ["пятерочка", "магнит", "перекресток", "дикси", "лента", "ашан", "вкусвилл", "fix price", "wildberries", "ozon"];

// ПАРСИНГ 2ГИС
async function findBusinesses(city) {
    try {
        // 1. Получаем ID города
        const cityRes = await axios.get(`https://catalog.api.2gis.com/3.0/items?q=${encodeURIComponent(city)}&type=city&key=rubnkm0668`); 
        // (это публичный ключ с их фронтенда, иногда работает)
        
        let cityId = null;
        if (cityRes.data && cityRes.data.result && cityRes.data.result.items.length > 0) {
            cityId = cityRes.data.result.items[0].id;
        }

        // Если ключ не сработал, используем прямой парсинг страницы
        const searchUrl = `https://2gis.ru/${encodeURIComponent(city)}/search/Кафе`;
        const res = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        // Ищем JSON с данными в коде страницы
        const html = res.data;
        const jsonMatch = html.match(/window\.initialState = (.*?);/);
        
        let businesses = [];

        if (jsonMatch) {
            try {
                const state = JSON.parse(jsonMatch[1]);
                // Тут сложная структура, но мы вытаскиваем то, что нужно
                const catalog = state.catalog || state.search;
                if (catalog && catalog.items) {
                    for (let item of catalog.items) {
                        const name = item.name;
                        if (!name) continue;
                        
                        // Фильтр сетей
                        const lowerName = name.toLowerCase();
                        if (BLACKLIST.some(w => lowerName.includes(w))) continue;

                        let phone = "Нет телефона";
                        let website = null;
                        let address = item.address_name || "Адрес уточняется";

                        if (item.contact_groups) {
                            for (let g of item.contact_groups) {
                                if (g.contacts) {
                                    const p = g.contacts.find(c => c.type === 'phone');
                                    const w = g.contacts.find(c => c.type === 'website');
                                    if (p) phone = p.value;
                                    if (w) website = w.url;
                                }
                            }
                        }

                        // Если есть сайт - пропускаем
                        if (website) continue;

                        // Если есть телефон - добавляем
                        if (phone !== "Нет телефона") {
                            businesses.push({
                                name: name,
                                address: address,
                                phone: phone,
                                photo: `https://source.unsplash.com/400x300/?business,${encodeURIComponent(name)}`
                            });
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
        const msg = await ctx.reply('⏳ Ищу бизнесы на 2ГИС (1-2 сек)...');
        
        searchResults = await findBusinesses("Москва"); // Тут можешь поменять город
        
        if (searchResults.length === 0) {
            return ctx.editMessageText("😔 На 2ГИС не найдено бизнесов без сайта. Попробуйте позже.");
        }
        currentIndex = 0;
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

// ... (Остальной код (save_ask, save_direct, set_time, stats, reminders, back, setInterval) оставь тот же, что был в прошлом сообщении) ...
