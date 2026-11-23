const { Telegraf } = require('telegraf');

const BOT_TOKEN = '9124366756:AAH5fAq5hfEbmBujc22a7oM59h6SMBVBmw0';
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
    ctx.reply("Бот работает! Введи /test");
});

bot.command('test', (ctx) => {
    ctx.reply("Тест пройден!");
});

bot.launch();
console.log('PivoShop bot up');
