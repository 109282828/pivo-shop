const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const BOT_TOKEN = '9124366756:AAH5fAq5hfEbmBujc22a7oM59h6SMBVBmw0';
const bot = new Telegraf(BOT_TOKEN);

let savedBusinesses = [];
let reminders = [];
const awaiting = {}; // Для диалогов ввода

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
        const jsonMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/);
        
        let businesses = [];

        if (jsonMatch) {
            try {
                const state = JSON.parse(jsonMatch[1]);
                let orgs = [];

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
                            phone: phone,
                            photo: `https://source.unsplash.com/400x300/?business,${encodeURIComponent(name)}`
                        });
                    }
                }
            } catch (e) {
                console.log("Ошибка парсинга:", e.message);
            }
        }

        if (businesses.length === 0) {
            businesses = [
                { name: "Стоматология 'Улыбка'", address: "Москва, пр. Мира, 42", phone: "+7 (988) 765-43-21", photo: "https://source.unsplash.com/400x300/?dentist" },
                { name: "Кофейня 'Пенка'", address: "Москва, ул. Ленина, 15", phone: "+7 (999) 123-45-67", photo: "https://source.unsplash.com/400x300/?cafe" }
            ];
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
    ctx.answerCbQuery('Ищу...');
    const msg = await ctx.reply('⏳ Ищу бизнесы в Москве...');
    
    const results = await findBusinesses("Москва");
    
    if (results.length === 0) {
        return ctx.editMessageText("😔 Не найдено. Попробуйте позже.");
    }

    const biz = results[Math.floor(Math.random() * results.length)];

    const text = `🏢 *${biz.name}*\n\n📍 Город: *Москва*\n📍 Адрес: ${biz.address}\n📞 Телефон: ${biz.phone}\n\n💬 *Приветствие:*\n_${greeting}_\n\n📝 *Если согласились:*\n_${followUp}_`;

    try {
        await ctx.replyWithPhoto(biz.photo, {
            caption: text,
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('➕ В работу', `ask_time:${biz.name}`), Markup.button.callback('➖ Пропустить', 'search')]
            ])
        });
    } catch (e) {
        await ctx.reply(text, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('➕ В работу', `ask_time:${biz.name}`), Markup.button.callback('➖ Пропустить', 'search')]
            ])
        });
    }
    
    ctx.deleteMessage(msg.message_id);
});

// Спрашиваем время
bot.action(/^ask_time:(.+)$/, (ctx) => {
    const bizName = ctx.match[1];
    awaiting[ctx.from.id] = { type: 'await_time', bizName: bizName };
    ctx.reply(`Когда перезвонить в *${bizName}*?\n\nНапишите дату и время в формате:\n\`2026-11-25 15:30\` (Год-Месяц-День Час:Минута)`, { parse_mode: 'Markdown' });
});

// Обработка ввода времени
bot.on('text', async (ctx) => {
    const s = awaiting[ctx.from.id];
    if (s && s.type === 'await_time') {
        const timeText = ctx.message.text;
        
        // Парсим дату
        const reminderTime = new Date(timeText).getTime();
        
        if (isNaN(reminderTime)) {
            return ctx.reply("❌ Неверный формат. Напиши так: `2026-11-25 15:30`", { parse_mode: 'Markdown' });
        }

        // Сохраняем бизнес
        if (!savedBusinesses.find(b => b.name === s.bizName)) {
            savedBusinesses.push({ name: s.bizName, status: `Напомнить: ${timeText}` });
        }

        // Сохраняем напоминание
        reminders.push({
            chatId: ctx.chat.id,
            bizName: s.bizName,
            time: reminderTime
        });

        delete awaiting[ctx.from.id];
        ctx.reply(`✅ Напоминание для *${s.bizName}* установлено на ${timeText}.\nПродолжаю поиск...`, { parse_mode: 'Markdown' });
        
        // Сразу запускаем следующий поиск
        bot.handleUpdate({ ...ctx.update, callback_query: { ...ctx.callbackQuery, data: 'search' } });
    }
});

// Статистика
bot.action('stats', (ctx) => {
    if (!savedBusinesses.length) return ctx.reply("Статистика пуста.", Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'back')]]));
    
    let text = `📊 *В работе (${savedBusinesses.length}):*\n\n`;
    savedBusinesses.forEach((b, i) => {
        text += `${i + 1}. *${b.name}* (${b.status})\n`;
    });
    ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'back')]]) });
});

// Напоминания
bot.action('reminders', (ctx) => {
    if (!reminders.length) return ctx.reply("Напоминаний нет.", Markup.inlineKeyboard([[Markup.button.callback('« Назад', 'back')]]));
    
    let text = `⏰ *Твои напоминания:*\n\n`;
    reminders.forEach((r, i) => {
        const date = new Date(r.time).toLocaleString('ru-RU');
        text += `${i + 1}. *${r.bizName}*\n🕒 ${date}\n\n`;
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

// Цикл проверки напоминаний (каждую минуту)
setInterval(() => {
    const now = Date.now();
    reminders = reminders.filter(r => {
        // Если время пришло (плюс-минус 1 минута)
        if (now >= r.time && now < r.time + 60000) {
            bot.telegram.sendMessage(r.chatId, `🔔 *НАПОМИНАНИЕ!*\n\nПора перезвонить в *${r.bizName}*!`, { parse_mode: 'Markdown' });
            return false; // Удаляем из списка
        }
        return true;
    });
}, 60000); // Каждую минуту

bot.launch();
console.log('PivoShop bot up');
