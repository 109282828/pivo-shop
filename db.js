const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'pivoshop.json');
let savedBusinesses = [];
let reminders = [];

if (fs.existsSync(DB_FILE)) {
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        savedBusinesses = data.savedBusinesses || [];
        reminders = data.reminders || [];
    } catch (e) {}
}

function saveToFile() {
    try {
        const data = { savedBusinesses, reminders };
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e) {}
}

module.exports = {
    addBusiness(biz) {
        if (!savedBusinesses.find(b => b.name === biz.name)) {
            savedBusinesses.push(biz);
            saveToFile();
        }
    },
    getBusinesses() {
        return savedBusinesses;
    },
    addReminder(reminder) {
        reminders.push(reminder);
        saveToFile();
    },
    getReminders() {
        return reminders;
    },
    removeReminder(id) {
        reminders = reminders.filter(r => r.id !== id);
        saveToFile();
    }
};
