// ======================================================
// TELEGRAM SMART ROBO BOT
// v4: استیکر و گیف، شناخت اعضا، مشارکت متعادل‌تر
// v5: شروع بحث توسط خود روبو، مالک (پل پیوی↔گروه)، لحن آروم‌تر
// v6: ادامه‌ی گفتگو بدون صدا زدن (ENGAGE)، حال‌وهواهای خودخواسته (MOODS)،
//     فعال‌تر شدن توی گروه، و دستورهای مالک از پیوی (پیام دادن / سوژه کردن توی گروه)
// v11: مدیریت گروه (roboModeration): گزارش تمسخر نظام به مالک + حذف/سکوت با دستور مالک،
//     و گیف/استیکرِ ممنوع (حذف خودکار + اخطارِ هوش مصنوعی)
// ======================================================
require("./roboSpeed").install();

const TelegramBot = require("node-telegram-bot-api");

const fs = require("fs");

const path = require("path");

const {
    saveMemory,
    getMemory,
    getUserName,
    saveGroupMessage,
    getRecentGroupMessages,
    touchMember,
    getProfiles,
    getRoster,
    countKnownMembers,
    setMemberFlags,
    forgetMember,
    touchGroupChat,
    getKnownGroups,
    setGroupObserving,
    getObservingChatIds
} = require("../services/roboMemoryService");

const { getSiteContext } = require("../services/siteBrainService");

const { isBinaryMessage, isPromptInjection } = require("./guards");

const { think, normalizeEmoji, ALLOWED_REACTIONS } = require("./roboBrain");

const media = require("./roboMedia");

const profiler = require("./roboProfiler");

const voice = require("./roboVoice");

const format = require("./roboFormat");

const search = require("./roboSearch");

const quiet = require("./roboQuiet");

const moderation = require("./roboModeration");

console.log("🔥 TELEGRAM ROBO BOT LOADED");

const TOKEN = process.env.TELEGRAM_TOKEN;

let bot = null;

let botInfo = { id: null, username: "" };

const FILE_DIR = path.join(__dirname, "../temp-files");

// ======================================================
// CONFIG — رفتار انسانی روبو اینجا تنظیم می‌شه
// ======================================================

const CONFIG = {

    // چند پیام آخر گروه به مدل داده بشه
    CONTEXT_MESSAGES: 30,

    // بعد از آخرین پیام گروه، چند میلی‌ثانیه صبر کنه تا ببینه بحث تموم شد
    DEBOUNCE_MS: 3000,

    // حداکثر انتظار (وسط گفتگوی شلوغ هم گاهی فرصت دخالت پیدا کنه)
    MAX_WAIT_MS: 18000,

    // احتمال پایه‌ی اینکه اصلاً به یه پیام بی‌خطاب فکر کنه (۰ تا ۱)
    // پایینه چون روبو فقط وقتی وارد می‌شه که چیزی برای گفتن داشته باشه؛
    // سوال، حرف درباره‌ی ربات/سایت و ... احتمال رو بالا می‌برن (interestChance)
    // (بالاتر = فعال‌تر)
    BASE_CHANCE: 0.12,

    // حداقل فاصله بین دو دخالت خودخواسته‌ی روبو
    COOLDOWN_MS: 3 * 60 * 1000,

    // حداکثر دخالت خودخواسته در ساعت برای هر گروه
    MAX_PROACTIVE_PER_HOUR: 6,

    // بین دو حرفِ خودخواسته‌ی روبو حداقل این‌قدر پیامِ آدم‌ها بیاد
    // (اگه پیامِ آخر سوال باشه، QUESTION_MIN_BETWEEN)
    MIN_HUMAN_BETWEEN: 5,
    QUESTION_MIN_BETWEEN: 3,

    // اگه توی ۴۵ ثانیه‌ی اخیر این‌قدر پیام اومده، گروه شلوغه؛ صبر کنه آروم بشه
    BUSY_MESSAGES: 6,

    // تعادل: از N پیام آخر، سهم روبو بیشتر از این نباشه (۰.۱۵ = حدود یک‌هفتم)
    // (اگه هنوز زیاده کمترش کن؛ مثلاً ۰.۱۰)
    SHARE_WINDOW: 20,
    MAX_BOT_SHARE: 0.15,

    // حداقل فاصله بین دو استیکر/گیف
    MEDIA_GAP_DIRECT_MS: 30 * 1000,
    MEDIA_GAP_PROACTIVE_MS: 3 * 60 * 1000,

    // پیام‌های قدیمی‌تر از این (ثانیه) رو بعد از ری‌استارت جواب نده
    STALE_SECONDS: 120,

    // ساعت‌هایی که فقط وقتی صداش بزنن جواب می‌ده (مثل آدمی که خوابه)
    // برای خاموش کردن: QUIET_HOURS: null
    QUIET_HOURS: { start: 2, end: 8 },

    TIMEZONE: "Asia/Tehran",

    // چند نفر از اعضای بحث (و پروفایلشون) به مدل داده بشه
    PEOPLE_MAX: 8,

    // کش لیست اعضا
    ROSTER_CACHE_MS: 2 * 60 * 1000,

    // هر چند وقت یه بار لیست ادمین‌ها و تعداد اعضای گروه از تلگرام گرفته بشه
    PRIME_EVERY_MS: 6 * 60 * 60 * 1000

};

// ======================================================
// SPARK — روبو خودش گپ رو باز می‌کنه (وقتی گروه مدتیه ساکته)
// ======================================================

const SPARK = {

    // خاموش کردن: ENABLED: false
    ENABLED: true,

    // هر چند دقیقه یه بار گروه‌ها بررسی بشن
    TICK_MS: 3 * 60 * 1000,

    // گروه حداقل این‌قدر ساکت باشه (و حداکثر این‌قدر؛ گروهِ مرده رو بیدار نمی‌کنه)
    SILENCE_MIN_MS: 25 * 60 * 1000,

    SILENCE_MAX_MS: 48 * 60 * 60 * 1000,

    // حداقل فاصله از آخرین حرف خود روبو
    MIN_GAP_MS: 50 * 60 * 1000,

    // حداکثر شروع بحث در شبانه‌روز برای هر گروه
    MAX_PER_DAY: 4,

    // توی هر بررسی، با این احتمال اصلاً بره سراغش (کمی تصادفی بودن)
    CHANCE: 0.4,

    // فقط توی این ساعت‌ها (به وقت تهران)
    HOURS: { start: 9, end: 24 }

};

// ======================================================
// ENGAGE — بعد از اینکه کسی صداش زد (یا روبو خودش به کسی حرف زد)،
// پیام‌های بعدیِ همون آدم هم خطاب به روبو حساب می‌شه؛ لازمه نیست هر بار اسمش رو بیاره.
// اگه طرف داره با یکی دیگه حرف می‌زنه (ریپلای به یه نفر دیگه، منشنِ یه نفر دیگه)
// یا چند نفر دیگه وسط حرف زدن، روبو نمی‌پره وسط.
// ======================================================

const ENGAGE = {

    // خاموش کردن: ENABLED: false
    ENABLED: true,

    // بعد از آخرین تعامل با یه نفر، تا این‌قدر پیام‌های بعدیش «ادامه‌ی گفتگو» حساب می‌شه
    WINDOW_MS: 5 * 60 * 1000,

    // اگه این‌قدر پیامِ آدم‌های دیگه وسط اومد، گفتگو تموم‌شده فرض می‌شه
    MAX_OTHERS_BETWEEN: 8,

    // سقف جوابِ پشت‌سرهم بدون اینکه دوباره اسم روبو بیاد
    MAX_TURNS: 15,

    // اگه آدم چند پیام پشت‌سرهم نوشت، این‌قدر صبر کن تا تموم کنه
    DEBOUNCE_MS: 1800

};

// ======================================================
// MOODS — حال‌وهوای دخالت‌های خودخواسته (هر بار یکی انتخاب می‌شه)
// وزن‌ها نسبی‌ان؛ برای خاموش کردن یه حالت وزنش رو بذار ۰
//  warm=مهربون  funny=شوخ  opinion=نظر دادن  serious=جدی
//  dignified=سنگین و باوقار  roast=سوژه کردن  rude=تند و بی‌ادب (فقط با آدمِ تیکه‌پذیرِ سطح ۳)
// ======================================================

const MOODS = {

    WEIGHTS: {
        warm: 22,
        funny: 26,
        opinion: 16,
        serious: 8,
        dignified: 6,
        roast: 16,
        rude: 6
    },

    // حداقل فاصله بین دو «سوژه کردن» توی یه گروه
    ROAST_GAP_MS: 8 * 60 * 1000,

    // یه نفر رو توی این بازه دوباره سوژه نکنه
    SAME_TARGET_GAP_MS: 30 * 60 * 1000

};

// ======================================================
// SMALL HELPERS
// ======================================================

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const rand = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

const pick = list => list[Math.floor(Math.random() * list.length)];

// یکدست‌سازی متن فارسی برای مقایسه (ي/ی، ك/ک، نیم‌فاصله، اعراب، علامت‌ها)
function normFa(text) {

    return String(text || "")
        .toLowerCase()
        .replace(/[يى]/g, "ی")
        .replace(/ك/g, "ک")
        .replace(/[\u064B-\u065F\u0640]/g, "")
        .replace(/\u200c/g, " ")
        .replace(/[^\p{L}\p{N}@_\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();

}

const SITE_WORDS = /سایت|فایل|درس|جزوه|ریزئو|riseo|pdf|دانلود|نمونه\s?سوال|امتحان|کتاب/i;

// حرف زدن درباره‌ی ربات و هوش مصنوعی (روبو دوست داره وارد این بحث‌ها بشه)
const BOT_TALK = /(?<![\p{L}])(?:ربات|روبات|بات|هوش\s?مصنوعی|chatgpt|gpt|gemini|جمینای)(?![\p{L}])/iu;

// جای شوخی نیست: غم، استرس، بیماری، «بس کن»... (روی متنِ بدون نیم‌فاصله چک می‌شه)
const SAD_TEXT = /غمگین|ناراحت|افسرده|گریه|بغض|مریض|بیمار|فوت|عزا|بد\s?حالم|حالم\s?بده|استرس|می\sترسم|تنهام|دلم\s?گرفته|بس\s?کن|اذیت\s?نکن|ولم\s?کن/;

const LAUGHY = /[😂🤣😹]|ه{3,}|خخ+/u;

const FORGET_LINES = [
    "باشه، هر چی از تو یادم بود پاک شد. از اول با هم آشنا می‌شیم 😄",
    "پاک شد. دفتر خاطراتم از تو سفید سفیده، حالا یه شروع تازه 😎"
];

const EMPTY_CALL_LINES = [
    "بله؟ گوشم با توئه 👋",
    "جانم؟ بگو",
    "هوم؟ بنال ببینم",
    "بفرما، چی شده؟"
];

const BLOCK_LINES = [
    "نه جوجه، گول نمی‌خورم 😂",
    "این ترفندا برا من قدیمیه، یه چیز جدید بیار 😎",
    "فکر کردی با دو تا صفر و یک خر می‌شم؟ 😂",
    "هکر شدی؟ برو یه چایی بخور بابا"
];

const OBSERVE_ON_LINES = [
    "باشه، دیگه حرفی نمی‌زنم؛ فقط نگاه می‌کنم 👀",
    "چشم، ساکت شدم و فقط می‌خونم. هر وقت خواستی بگو «روبو بیا»",
    "باشه، نظاره‌گر می‌شم. با «روبو بیا» برمی‌گردم 👀"
];

const OBSERVE_OFF_LINES = [
    "اومدم! 😄 چه خبره؟",
    "برگشتم، چی از دست دادم؟ 😎",
    "باشه، دوباره بین شمام 👋"
];

const FAIL_LINES = [
    "مغزم یه لحظه هنگ کرد، دوباره بگو",
    "سرور داره نفس‌نفس می‌زنه، یه دقیقه دیگه بپرس 😅"
];

// ======================================================
// OWNER — مالک ربات (@DoZhn5898)
// تأیید فقط از روی اطلاعات خودِ تلگرام (آیدی و یوزرنیم) انجام می‌شه،
// نه از روی متن پیام؛ پس کسی با «من مالکم» مالک نمی‌شه.
//
// برای امنیت بیشتر توی .env بذار: OWNER_ID=آیدی عددی خودت
// (اولین باری که از مالک پیام بیاد، آیدی توی لاگ چاپ می‌شه)
// ======================================================

const OWNER_USERNAME = String(process.env.OWNER_USERNAME || "DoZhn5898")
    .replace(/^@/, "")
    .toLowerCase();

let ownerId = process.env.OWNER_ID ? String(process.env.OWNER_ID) : null;

function checkOwner(from) {

    if (!from) return false;

    const id = String(from.id);

    // آیدی ثابت شده: فقط همون
    if (ownerId) return id === ownerId;

    if (from.username && from.username.toLowerCase() === OWNER_USERNAME) {

        ownerId = id;

        console.log("👑 OWNER DETECTED:", id, "→ برای امنیت بیشتر توی .env بذار OWNER_ID=" + id);

        return true;

    }

    return false;

}

// ======================================================
// FILE SYSTEM
// ======================================================

function getFiles() {

    if (!fs.existsSync(FILE_DIR)) {
        return [];
    }

    return fs
        .readdirSync(FILE_DIR)
        .filter(x => !x.startsWith("."));

}

// ======================================================
// NAME / TRIGGER DETECTION
// ======================================================

// «روبو» یا «robo» به‌صورت کلمه‌ی مستقل؛ «روبوت» و «robot» نمی‌خورن
const NAME_SOURCE = "(?<![\\p{L}\\d])(?:روبو|robo)(?![\\p{L}\\d])";

const NAME_TEST = new RegExp(NAME_SOURCE, "iu");

const NAME_GLOBAL = new RegExp(NAME_SOURCE, "giu");

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTrigger(msg, text) {

    if (msg.chat.type === "private") return "private";

    if (
        botInfo.username &&
        text.toLowerCase().includes("@" + botInfo.username.toLowerCase())
    ) {
        return "mention";
    }

    if (NAME_TEST.test(text)) return "name";

    if (
        botInfo.id &&
        msg.reply_to_message &&
        msg.reply_to_message.from &&
        msg.reply_to_message.from.id === botInfo.id
    ) {
        return "reply_to_bot";
    }

    // ادامه‌ی گفتگو: همین آدم تازه با روبو حرف می‌زد و الان بدون صدا زدن می‌نویسه
    if (detectFollowup(msg, text)) return "followup";

    return "none";

}

function cleanMessage(text) {

    let result = text.replace(NAME_GLOBAL, "");

    if (botInfo.username) {

        result = result.replace(
            new RegExp("@" + escapeRegExp(botInfo.username), "gi"),
            ""
        );

    }

    return result
        .replace(/^[\s,،:؛.!؟?\-]+/, "")
        .trim();

}

// ======================================================
// EXTRACT USER NAME
// (قبلاً «اسم من چیه؟» رو هم به‌عنوان اسم ذخیره می‌کرد)
// ======================================================

function extractName(text) {

    const patterns = [
        /اسمم\s+(.+?)\s+(?:هست|است)\s*$/,
        /اسم\s+من\s+(.+?)\s+(?:هست|است)\s*$/,
        /منو\s+(.+?)\s+صدا\s*(?:کن|بزن)/,
        /اسمم\s+(.+)$/,
        /اسم\s+من\s+(.+)$/
    ];

    const bad = /[?؟!]|چی|کیه|یادت|میدونی|می‌دونی|می\sدونی|هست|نیست|بود|چنده/;

    for (const regex of patterns) {

        const match = text.match(regex);

        if (!match) continue;

        const name = match[1].trim();

        if (name.length < 2 || name.length > 20) continue;

        if (name.split(/\s+/).length > 3) continue;

        if (bad.test(name)) continue;

        return name;

    }

    return null;

}

// کش اسم کاربرها تا برای هر پیام گروه به دیتابیس نخوریم

const nameCache = new Map();

async function resolveName(chatId, userId, from) {

    const key = chatId + ":" + userId;

    const hit = nameCache.get(key);

    if (hit && Date.now() - hit.at < 10 * 60 * 1000) {
        return hit.name;
    }

    let name = null;

    try {
        name = await getUserName(chatId, userId);
    }
    catch (e) { /* مهم نیست */ }

    name = name || (from && (from.first_name || from.username)) || "کاربر";

    nameCache.set(key, { name, at: Date.now() });

    return name;

}

// ======================================================
// TELEGRAM ACTIONS
// ======================================================

async function sendOut(chatId, text, options = {}) {

    // متن مرتب می‌شه (پاراگراف‌بندی)، کد و پرامپت می‌ره توی بلاک کدِ قابل‌کپی
    // و پیام‌های خیلی بلند بدون خراب شدن بلاک کد تکه‌تکه می‌شن
    const parts = format.formatForTelegram(text);

    // چیزی برای فرمت کردن نبود: همون رفتار قدیمی
    if (!parts.length) {
        parts.push({ html: null, plain: String(text).slice(0, 4000) });
    }

    let first = null;

    for (let i = 0; i < parts.length; i++) {

        const params = {};

        // فقط پیام اول ریپلای می‌شه؛ بقیه‌ی تکه‌ها پشتش میان
        if (i === 0 && options.replyTo) {
            params.reply_to_message_id = options.replyTo;
            params.allow_sending_without_reply = true;
        }

        if (options.threadId) {
            params.message_thread_id = options.threadId;
        }

        // پیام وضعیتِ «دارم سرچ می‌کنم...» همین‌جا به جواب تبدیل می‌شه
        if (i === 0 && options.editMessageId) {

            const edited = await editInPlace(chatId, options.editMessageId, parts[0]);

            if (edited) {

                first = edited;

                if (i < parts.length - 1) await sleep(500);

                continue;

            }

            // ادیت نشد (مثلاً پیام پاک شده): پیام قدیمی رو جمع کن و جواب رو عادی بفرست
            bot.deleteMessage(chatId, options.editMessageId).catch(() => { });

        }

        let sent;

        try {

            sent = parts[i].html
                ? await bot.sendMessage(chatId, parts[i].html, Object.assign({ parse_mode: "HTML" }, params))
                : await bot.sendMessage(chatId, parts[i].plain, params);

        }
        catch (error) {

            // تلگرام فرمت HTML رو نپذیرفت: همون متن رو ساده بفرست
            if (!parts[i].html || !/parse entities|can't parse|unsupported start tag/i.test(String(error.message))) {
                throw error;
            }

            console.log("⚠️ HTML SEND FAILED, SENDING PLAIN:", error.message);

            sent = await bot.sendMessage(chatId, parts[i].plain, params);

        }

        if (!first) first = sent;

        if (i < parts.length - 1) await sleep(500);

    }

    return first;

}

// ======================================================
// STATUS MESSAGE — «دارم سرچ می‌کنم...» که بعد به جواب تبدیل می‌شه
// ======================================================

// متن یه پیامِ فرستاده‌شده رو عوض می‌کنه؛ موفق نشد null برمی‌گردونه
async function editInPlace(chatId, messageId, part) {

    const base = { chat_id: chatId, message_id: messageId };

    const done = result => (result && typeof result === "object" ? result : { message_id: messageId });

    try {

        return done(
            part.html
                ? await bot.editMessageText(part.html, Object.assign({ parse_mode: "HTML" }, base))
                : await bot.editMessageText(part.plain, base)
        );

    }
    catch (error) {

        const message = String(error.message);

        if (part.html && /parse entities|can't parse|unsupported start tag/i.test(message)) {

            try {
                return done(await bot.editMessageText(part.plain, base));
            }
            catch (second) { /* پایین لاگ می‌شه */ }

        }

        console.log("⚠️ EDIT FAILED:", message);

        return null;

    }

}

const SEARCH_STATUS_LINES = [
    q => `🔎 یه لحظه صبر کن، دارم «${q}» رو سرچ می‌کنم...`,
    q => `🔎 باشه، دارم «${q}» رو توی نت می‌گردم...`,
    q => `🔎 دارم «${q}» رو چک می‌کنم، الان میگم...`,
    q => `🔎 همین الان «${q}» رو سرچ می‌کنم، چند ثانیه...`
];

// تابعی که roboSearch درست قبل از سرچِ واقعی صدا می‌زنه
function makeSearchAnnouncer(chatId, info, isPrivate, status) {

    return async query => {

        const shown = String(query || "").replace(/\s+/g, " ").trim().slice(0, 60);

        if (!shown) return;

        const params = {};

        if (!isPrivate && info.messageId) {
            params.reply_to_message_id = info.messageId;
            params.allow_sending_without_reply = true;
        }

        if (info.threadId) params.message_thread_id = info.threadId;

        const sent = await bot.sendMessage(chatId, pick(SEARCH_STATUS_LINES)(shown), params);

        status.id = sent.message_id;

        console.log("🔎 STATUS SENT:", sent.message_id, "|", shown);

    };

}

// پیام وضعیت به جواب تبدیل نشد (ویس، ریکشن، ignore، خطا...): پاکش کن
async function dropStatus(chatId, status) {

    if (!status || !status.id) return;

    const id = status.id;

    status.id = null;

    await bot.deleteMessage(chatId, id).catch(() => { });

}

// قدیمی‌ترین تابع send برای دستورهای فایل
async function send(chat, text) {

    try {

        const result = await bot.sendMessage(chat, text);

        console.log("✅ SENT:", result.message_id);

    }
    catch (error) {

        console.log("SEND ERROR:", error.message);

    }

}

// صدا زدن مستقیم API تلگرام (به نسخه‌ی کتابخونه وابسته نیست؛ نیاز به Node 18+)
async function tg(method, body) {

    const response = await fetch(
        `https://api.telegram.org/bot${TOKEN}/${method}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {})
        }
    );

    const data = await response.json();

    if (!data.ok) {
        throw new Error(`${method}: ${data.description}`);
    }

    return data.result;

}

async function setReaction(chatId, messageId, emoji) {

    const normalized = normalizeEmoji(emoji);

    if (!normalized || !ALLOWED_REACTIONS.has(normalized)) return;

    try {

        await tg("setMessageReaction", {
            chat_id: chatId,
            message_id: messageId,
            reaction: [{ type: "emoji", emoji: normalized }]
        });

        console.log("👍 REACTED:", normalized, "→", messageId);

    }
    catch (error) {

        console.log("REACTION ERROR:", error.message);

    }

}

function startTyping(chatId, threadId, action = "typing") {

    let active = true;

    const tick = () => {

        if (!active) return;

        bot
            .sendChatAction(
                chatId,
                action,
                threadId ? { message_thread_id: threadId } : {}
            )
            .catch(() => { });

    };

    tick();

    const timer = setInterval(tick, 4000);

    return () => {
        active = false;
        clearInterval(timer);
    };

}

// مکث قبل از ارسال: آدم‌ها تایپ می‌کنن، فوری جواب نمی‌دن
async function humanWait(chatId, threadId, length, direct) {

    const ms = direct
        ? rand(300, 900) + Math.min(length * 15, 2500)
        : rand(1200, 2500) + Math.min(length * 30, 5000);

    const stop = startTyping(chatId, threadId);

    await sleep(ms);

    stop();

}

// مکث کوتاه قبل از استیکر/گیف (آدم‌ها «استیکر انتخاب می‌کنن»)
async function stickerWait(chatId, threadId) {

    const stop = startTyping(chatId, threadId, "choose_sticker");

    await sleep(rand(900, 2200));

    stop();

}

// ساعت فعلی به وقت تهران + حال‌وهوای روز (برای خودِ مدل هم می‌ره)
function nowInfo() {

    const parts = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: CONFIG.TIMEZONE
    }).formatToParts(new Date());

    const hour = Number(parts.find(p => p.type === "hour").value);

    const minute = parts.find(p => p.type === "minute").value;

    const label = hour < 5
        ? "نیمه‌شب"
        : hour < 11
            ? "صبح"
            : hour < 14
                ? "ظهر"
                : hour < 17
                    ? "بعدازظهر"
                    : hour < 20
                        ? "عصر"
                        : "شب";

    // تاریخ امروز (شمسی + میلادی)؛ بدونش مدل نمی‌دونه «امروز» و «آخرین» یعنی کی
    return {
        hour,
        text: `${search.todayText()}، ساعت ${String(hour).padStart(2, "0")}:${minute} (${label})`
    };

}

function isQuietHour() {

    const quiet = CONFIG.QUIET_HOURS;

    if (!quiet) return false;

    const hour = nowInfo().hour;

    return quiet.start < quiet.end
        ? hour >= quiet.start && hour < quiet.end
        : hour >= quiet.start || hour < quiet.end;

}

// ======================================================
// PER-CHAT STATE
// ======================================================

const chats = new Map();

function st(chatId) {

    if (!chats.has(chatId)) {

        chats.set(chatId, {
            timer: null,
            pendingSince: 0,
            busy: 0,
            chain: Promise.resolve(),
            lastBotAt: 0,
            lastProactiveAt: 0,
            proactiveTimes: [],
            lastInfo: null,
            lastMediaAt: 0,
            lastVoiceAt: 0,
            recentMedia: [],
            engaged: new Map(),
            lastRoastAt: 0,
            lastRoastUserId: null
        });

    }

    return chats.get(chatId);

}

// کارهای هر چت پشت‌سرهم اجرا می‌شن تا جواب‌ها قاطی نشن
function enqueue(chatId, job) {

    const state = st(chatId);

    state.busy++;

    state.chain = state.chain
        .then(job)
        .catch(error => console.log("❌ ROBO JOB ERROR:", error.message))
        .finally(() => { state.busy--; });

    return state.chain;

}

// ======================================================
// ENGAGE (ادامه‌ی گفتگو بدون صدا زدن)
// ======================================================

// صدا زدن مستقیم، یا اینکه روبو خودش یه نفر رو مخاطب قرار داد
function openEngage(chatId, userId) {

    if (!ENGAGE.ENABLED || !userId) return;

    st(chatId).engaged.set(String(userId), {
        until: Date.now() + ENGAGE.WINDOW_MS,
        others: 0,
        turns: 0
    });

}

// بعد از هر جوابِ روبو توی گفتگو: پنجره تمدید می‌شه
function touchEngage(chatId, userId) {

    if (!ENGAGE.ENABLED || !userId) return;

    const map = st(chatId).engaged;

    const prev = map.get(String(userId));

    map.set(String(userId), {
        until: Date.now() + ENGAGE.WINDOW_MS,
        others: 0,
        turns: prev ? prev.turns + 1 : 1
    });

}

function closeEngage(chatId, userId) {

    st(chatId).engaged.delete(String(userId));

}

// هر پیامِ یه آدمِ دیگه یعنی گفتگو یه قدم از دست این آدم دور شد
function bumpOthers(chatId, userId) {

    if (!ENGAGE.ENABLED) return;

    const map = st(chatId).engaged;

    const now = Date.now();

    for (const [id, entry] of map) {

        if (now > entry.until || entry.others >= ENGAGE.MAX_OTHERS_BETWEEN) {
            map.delete(id);
            continue;
        }

        if (id !== String(userId)) entry.others++;

    }

}

function detectFollowup(msg, text) {

    if (!ENGAGE.ENABLED || !msg.from || msg.chat.type === "private") return false;

    const state = chats.get(String(msg.chat.id));

    if (!state) return false;

    const key = String(msg.from.id);

    const entry = state.engaged.get(key);

    if (!entry) return false;

    if (
        Date.now() > entry.until ||
        entry.others >= ENGAGE.MAX_OTHERS_BETWEEN ||
        entry.turns >= ENGAGE.MAX_TURNS
    ) {
        state.engaged.delete(key);
        return false;
    }

    // ریپلای به یه نفر دیگه = داره با اون حرف می‌زنه
    const replied = msg.reply_to_message && msg.reply_to_message.from;

    if (replied && (!botInfo.id || replied.id !== botInfo.id)) return false;

    // منشنِ یه نفر دیگه = خطاب به اون
    const tags = String(text || "").match(/@[A-Za-z0-9_]{4,}/g) || [];

    const me = "@" + String(botInfo.username || "").toLowerCase();

    if (tags.some(tag => tag.toLowerCase() !== me)) return false;

    return true;

}

// چند پیامِ پشت‌سرهمِ یه نفر یه جواب می‌گیره، نه چند تا
const followTimers = new Map();

function scheduleFollowup(chatId, userId, job) {

    const key = chatId + ":" + userId;

    const old = followTimers.get(key);

    if (old) clearTimeout(old.timer);

    const first = old ? old.first : Date.now();

    const wait = Date.now() - first > 6000 ? 0 : ENGAGE.DEBOUNCE_MS;

    const timer = setTimeout(() => {

        followTimers.delete(key);

        enqueue(chatId, () => respond(job));

    }, wait);

    followTimers.set(key, { timer, first });

}

// کارِ یه چت رو توی صفِ همون چت اجرا کن و نتیجه‌اش رو برگردون
function enqueueResult(chatId, job) {

    return new Promise(resolve => {

        enqueue(chatId, async () => {

            try {
                resolve(await job());
            }
            catch (error) {
                console.log("❌ ROBO JOB ERROR:", error.message);
                resolve(false);
            }

        });

    });

}

// کدوم آدم‌ها توی یه متن اسم برده شدن (با اسم یا @یوزرنیم)
function findMentionedPeople(text, people) {

    const tokens = new Set(normFa(text).split(" ").filter(Boolean));

    return (people || []).filter(p => {

        if (!p || String(p.userId) === String(botInfo.id)) return false;

        if (p.username && tokens.has("@" + String(p.username).toLowerCase())) return true;

        return normFa(p.name)
            .split(" ")
            .filter(t => t.length >= 2)
            .some(t => tokens.has(t));

    });

}

// ======================================================
// MOOD PICKER (دخالت‌های خودخواسته؛ هر بار یه حال‌وهوای متفاوت)
// ======================================================

function isRoastable(profile) {

    if (!profile || String(profile.userId) === String(botInfo.id)) return false;

    if (profile.noTeasing) return false;

    const learned = profile.learned || {};

    // نوجوون‌ها و آدم‌های کم‌شوخی سوژه‌ی خودخواسته نمی‌شن
    if (learned.young === true || learned.humor === "low") return false;

    const ceiling = profiler.teaseCeiling(profile);

    if (ceiling >= 2) return true;

    // هنوز تحلیل هوشمند نشده ولی از شمارنده‌ها معلومه که اهل خنده و شوخیه
    const n = Number(profile.msgCount || 0);

    return ceiling >= 1 && n >= 10 && Number(profile.laughCount || 0) / n > 0.12;

}

function weightedPick(weights) {

    const entries = Object.entries(weights).filter(([, w]) => w > 0);

    if (!entries.length) return "funny";

    let total = 0;

    for (const [, w] of entries) total += w;

    let roll = Math.random() * total;

    for (const [key, w] of entries) {

        roll -= w;

        if (roll <= 0) return key;

    }

    return entries[0][0];

}

function pickMood(info, social, recent, state) {

    const lastText = String(info.text || "").replace(/\u200c/g, " ");

    const tailText = recent
        .slice(-4)
        .map(m => m.text)
        .join(" ")
        .replace(/\u200c/g, " ");

    // خوش‌آمد، یا جایی که کسی ناراحته: فقط مهربون
    if (info.kind === "join") return { key: "warm", target: null };

    if (SAD_TEXT.test(lastText) || SAD_TEXT.test(tailText)) {
        return { key: "warm", target: null };
    }

    const now = Date.now();

    const weights = Object.assign({}, MOODS.WEIGHTS);

    // سوال و بحث درسی: جدی و کمک‌کن بهتره، نه تیکه
    if (/[?؟]/.test(lastText)) {
        weights.serious += 18;
        weights.warm += 8;
        weights.roast = 0;
        weights.rude = 0;
    }

    if (SITE_WORDS.test(lastText)) {
        weights.serious += 12;
        weights.rude = 0;
        weights.roast = Math.floor(weights.roast / 2);
    }

    if (LAUGHY.test(tailText)) {
        weights.funny += 10;
        weights.roast += 8;
    }

    // سوژه‌های ممکن (از آدم‌های همین بحث)
    const recentTarget = id =>
        state.lastRoastUserId === String(id) &&
        now - state.lastRoastAt < MOODS.SAME_TARGET_GAP_MS;

    const candidates = (social.people || [])
        .filter(isRoastable)
        .filter(p => !recentTarget(p.userId));

    if (!candidates.length || now - state.lastRoastAt < MOODS.ROAST_GAP_MS) {
        weights.roast = 0;
        weights.rude = 0;
    }

    const heavy = candidates.filter(p => profiler.teaseCeiling(p) >= 3);

    if (!heavy.length) weights.rude = 0;

    const key = weightedPick(weights);

    if (key !== "roast" && key !== "rude") return { key, target: null };

    const pool = key === "rude" ? heavy : candidates;

    // اگه همونی که الان حرف زده سوژه‌پذیره، بیشتر سراغ اونه
    const speaker = pool.find(p => String(p.userId) === String(info.userId));

    const chosen = speaker && Math.random() < 0.65 ? speaker : pick(pool);

    return {
        key,
        target: {
            userId: String(chosen.userId),
            name: chosen.name || chosen.username || "کاربر",
            username: chosen.username || null
        }
    };

}

// ======================================================
// GROUP META (ادمین‌ها و تعداد اعضا؛ تلگرام لیست کامل اعضا رو به ربات نمی‌ده،
// پس بقیه‌ی اعضا فقط وقتی شناخته می‌شن که توی گروه حرف بزنن یا وارد بشن)
// ======================================================

const chatMeta = new Map();

async function primeGroup(chat) {

    const chatId = String(chat.id);

    let meta = chatMeta.get(chatId);

    if (!meta) {

        meta = { admins: new Map(), memberCount: null, primedAt: 0, ready: false };

        chatMeta.set(chatId, meta);

    }

    if (Date.now() - meta.primedAt < CONFIG.PRIME_EVERY_MS) return meta;

    // اول زمان رو ثبت کن تا پیام‌های هم‌زمان یا خطا، حلقه نسازن
    meta.primedAt = Date.now();

    try {

        const admins = await tg("getChatAdministrators", { chat_id: chat.id });

        const next = new Map();

        for (const admin of admins) {

            if (!admin.user || admin.user.is_bot) continue;

            next.set(String(admin.user.id), admin.status);

            await touchMember({
                chatId,
                userId: String(admin.user.id),
                username: admin.user.username || null,
                name: admin.user.first_name || admin.user.username || "کاربر",
                role: admin.status,
                soft: true
            });

        }

        meta.admins = next;

        meta.ready = true;

    }
    catch (error) {

        console.log("PRIME ADMINS ERROR:", error.message);

    }

    try {

        meta.memberCount = await tg("getChatMemberCount", { chat_id: chat.id });

    }
    catch (error) { /* مهم نیست */ }

    return meta;

}

// ======================================================
// PEOPLE (پروفایل اعضا برای مدل)
// ======================================================

const rosterCache = new Map();

async function getRosterCached(chatId) {

    const hit = rosterCache.get(chatId);

    if (hit && Date.now() - hit.at < CONFIG.ROSTER_CACHE_MS) return hit;

    const [roster, known] = await Promise.all([
        getRoster(chatId, 40),
        countKnownMembers(chatId)
    ]);

    const entry = { at: Date.now(), roster, known };

    rosterCache.set(chatId, entry);

    return entry;

}

async function gatherPeople(chatId, info, recent) {

    const ids = [];

    for (let i = recent.length - 1; i >= 0 && ids.length < CONFIG.PEOPLE_MAX; i--) {

        const m = recent[i];

        if (m.isBot) continue;

        if (!ids.includes(String(m.userId))) ids.push(String(m.userId));

    }

    for (const extra of [info.userId, info.replyToUserId]) {

        if (extra && !ids.includes(String(extra))) ids.push(String(extra));

    }

    const [people, rosterEntry] = await Promise.all([
        getProfiles(chatId, ids),
        getRosterCached(chatId)
    ]);

    const meta = chatMeta.get(chatId);

    return {
        people,
        roster: rosterEntry.roster,
        known: rosterEntry.known,
        memberCount: meta ? meta.memberCount : null
    };

}

// ======================================================
// NOTES FOR THE MODEL (<situation>)
// ======================================================

function shareNoteFor(recent) {

    const tail = recent.slice(-CONFIG.SHARE_WINDOW);

    if (tail.length < 6) return "";

    const mine = tail.filter(m => m.isBot).length;

    return `از ${tail.length} پیام آخر گروه، ${mine} تاش مال خودته.`;

}

function mediaNoteFor(state) {

    if (!state.lastMediaAt) return "";

    const sec = Math.round((Date.now() - state.lastMediaAt) / 1000);

    if (sec > 30 * 60) return "";

    const ago = sec < 90 ? `${sec} ثانیه` : `${Math.round(sec / 60)} دقیقه`;

    return `آخرین استیکر یا گیفی که فرستادی حدود ${ago} پیش بوده.`;

}

function speakerNoteFor(info) {

    const parts = [];

    if (info.isOwner) {
        parts.push("(این آدم مالک و سازنده‌ی توئه؛ سیستم تأییدش کرده. باهاش صمیمی و چفت باش.)");
    }

    if (info.isNew) {
        parts.push("(اولین باره از این آدم توی گروه پیام می‌بینی؛ شاید تازه‌وارده، شاید تا حالا ساکت بوده.)");
    }
    else if (info.absentHours && info.absentHours >= 72) {
        parts.push(`(بعد از حدود ${Math.round(info.absentHours / 24)} روز غیبت برگشته.)`);
    }

    return parts.join(" ");

}

function groupNoteFor(social) {

    if (!social.memberCount) return "";

    return `گروه حدود ${social.memberCount} عضو داره؛ تو فقط ${social.known} نفرشون رو می‌شناسی (کسایی که تا حالا توی گروه حرف زدن).`;

}

// ======================================================
// BALANCE (متعادل بودن سهم روبو)
// ======================================================

function balanceAllows(recent) {

    // توی ۳ پیام آخر دوتاش از خودش بوده: بذار بقیه حرف بزنن
    if (recent.slice(-3).filter(m => m.isBot).length >= 2) return false;

    const tail = recent.slice(-CONFIG.SHARE_WINDOW);

    if (tail.length >= 8) {

        const share = tail.filter(m => m.isBot).length / tail.length;

        if (share > CONFIG.MAX_BOT_SHARE) return false;

    }

    return true;

}

// ======================================================
// PROACTIVE (دخالت خودخواسته مثل آدم)
// ======================================================

// ======================================================
// جریان گفتگو: الان اصلاً جای دخالت هست؟
// (قبل از اینکه مدل صدا زده بشه؛ ارزون و بدون هوش مصنوعی)
// ======================================================

function readFlow(recent, info) {

    // خوش‌آمد به تازه‌وارد همیشه جاش هست
    if (info.kind === "join") return { skip: false };

    const text = String(info.text || "").replace(/\u200c/g, " ");

    const isQuestion = /[?؟]/.test(text);

    const aboutUs = BOT_TALK.test(text) || SITE_WORDS.test(text);

    // ۱) از آخرین حرفِ روبو چند پیامِ آدم‌ها اومده؟
    let sinceBot = 0;

    for (let i = recent.length - 1; i >= 0; i--) {

        if (recent[i].isBot) break;

        sinceBot++;

    }

    const need = isQuestion ? CONFIG.QUESTION_MIN_BETWEEN : CONFIG.MIN_HUMAN_BETWEEN;

    if (sinceBot < need) {
        return { skip: true, why: `از حرف قبلیِ خودم فقط ${sinceBot} پیام گذشته` };
    }

    // ۲) خطاب به یه نفر دیگه (ریپلای به آدمِ دیگه یا منشنِ یه نفر)
    if (info.replyToUserId && String(info.replyToUserId) !== String(botInfo.id)) {
        return { skip: true, why: "داره به یکی دیگه جواب می‌ده" };
    }

    if (/@[A-Za-z0-9_]{4,}/.test(text)) {
        return { skip: true, why: "یکی رو منشن کرده" };
    }

    // ۳) دو نفر دارن با هم حرف می‌زنن (مگه درباره‌ی ربات یا سایت باشه)
    if (!aboutUs) {

        const humans = recent.filter(m => !m.isBot).slice(-6);

        const people = new Set(humans.map(m => String(m.userId)));

        if (humans.length >= 5 && people.size === 2) {
            return { skip: true, why: "دو نفر دارن با هم حرف می‌زنن" };
        }

    }

    // ۴) گروه شلوغه و پشت‌سرهم پیام می‌آد: صبر کن آروم بشه
    const now = Date.now();

    const burst = recent.filter(
        m => !m.isBot && now - new Date(m.createdAt).getTime() < 45 * 1000
    ).length;

    if (burst >= CONFIG.BUSY_MESSAGES && !aboutUs) {
        return { skip: true, why: "گروه شلوغه" };
    }

    return { skip: false };

}

function interestChance(info, state) {

    const value = String(info.text || "").trim();

    // تازه‌وارد: تقریباً همیشه ارزش یه خوش‌آمد رو داره
    if (info.kind === "join") return 0.9;

    let chance = CONFIG.BASE_CHANCE;

    // سوالِ بی‌جواب (آخرین پیامه و هنوز کسی جوابش رو نداده)
    if (/[?؟]/.test(value)) chance += 0.2;

    if (value.length < 6) chance -= 0.08;

    if (value.length > 80) chance += 0.04;

    if (SITE_WORDS.test(value)) chance += 0.15;

    if (BOT_TALK.test(value)) chance += 0.3;

    if (/[😂🤣😹]/u.test(value)) chance += 0.04;

    // استیکر و گیفِ تنها معمولاً حرفی برای جواب دادن نداره
    if (info.kind === "sticker" || info.kind === "gif") chance -= 0.05;

    // خیلی وقته چیزی نگفته: یه ذره بیشتر تمایل داره
    const quietMin = state.lastBotAt
        ? (Date.now() - state.lastBotAt) / 60000
        : 999;

    if (quietMin > 30) chance += 0.08;

    return Math.max(0.02, Math.min(0.6, chance));

}

function scheduleProactive(chatId, info) {

    // حالت نظاره‌گر: هیچ دخالتی برنامه‌ریزی نمی‌شه
    if (quiet.isObserving(chatId)) return;

    const state = st(chatId);

    state.lastInfo = info;

    const now = Date.now();

    if (state.timer) {

        // وسط بحث شلوغ هم بذار گاهی تایمر برسه
        if (now - state.pendingSince < CONFIG.MAX_WAIT_MS) {
            clearTimeout(state.timer);
        }
        else {
            return;
        }

    }
    else {
        state.pendingSince = now;
    }

    state.timer = setTimeout(
        () => {
            evaluateProactive(chatId)
                .catch(error => console.log("❌ PROACTIVE ERROR:", error.message));
        },
        CONFIG.DEBOUNCE_MS + rand(0, 2500)
    );

}

async function evaluateProactive(chatId) {

    const state = st(chatId);

    state.timer = null;
    state.pendingSince = 0;

    const info = state.lastInfo;

    if (!info) return;

    if (state.busy > 0) return;

    if (isQuietHour()) return;

    // حالت نظاره‌گر
    if (quiet.isObserving(chatId)) return;

    const now = Date.now();

    // تازه حرف زده؛ فوراً دوباره نیاد
    if (now - state.lastBotAt < 20 * 1000) return;

    if (now - state.lastProactiveAt < CONFIG.COOLDOWN_MS) return;

    state.proactiveTimes = state.proactiveTimes.filter(t => now - t < 60 * 60 * 1000);

    if (state.proactiveTimes.length >= CONFIG.MAX_PROACTIVE_PER_HOUR) return;

    // جریان گفتگو رو ببین: الان جای دخالت هست؟
    const flow = readFlow(
        await getRecentGroupMessages(chatId, CONFIG.CONTEXT_MESSAGES),
        info
    );

    if (flow.skip) {

        console.log("🤫 SKIP:", flow.why);

        return;

    }

    if (Math.random() > interestChance(info, state)) return;

    enqueue(chatId, () =>
        respond({
            chatId,
            info,
            trigger: "none",
            cleanText: info.text,
            newName: null
        })
    );

}

// ======================================================
// MEDIA PICK (استیکر/گیف)
// ======================================================

async function pickMediaForSend(state, want, direct) {

    const gap = direct
        ? CONFIG.MEDIA_GAP_DIRECT_MS
        : CONFIG.MEDIA_GAP_PROACTIVE_MS;

    if (Date.now() - state.lastMediaAt < gap) return null;

    return media.pickForSend(want.kind, want.mood, state.recentMedia);

}

// ======================================================
// GROUP REGISTRY (گروه‌هایی که روبو توشونه؛ برای پل مالک و ابتکار)
// ======================================================

const groupSeen = new Map();

function registerGroup(chat) {

    if (!chat || chat.type === "private") return;

    const id = String(chat.id);

    const last = groupSeen.get(id);

    if (last && Date.now() - last < 10 * 60 * 1000) return;

    groupSeen.set(id, Date.now());

    touchGroupChat({
        chatId: id,
        title: chat.title || null,
        type: chat.type
    }).catch(() => { });

}

// ======================================================
// OWNER BRIDGE — پیامِ مالک (پیوی) → گروه
// ======================================================

// آخرین گروهی که مالک ازش حرف زده (برای وقتی که اسم گروه رو نمی‌گه)
let ownerFocus = null;

// حرف از گروه و دستور و خبر گرفتنه؟ (برای وقتی که اسم گروه توی متن نیست)
const GROUP_ASK = /گروه|بچه\s?ها|برو|بگو|بنویس|بفرست|برسون|سوژه|مسخره|تیکه|رست|حالش|بپیچون|خبر|چی\s*شد|چه\s*خبر|چیکار|اعلام|بزن/;

// گروهی که مالک منظورشه: اسم گروه > کلمه‌های اسم > آخرین گروه > تک‌گروه
function resolveOwnerGroup(groups, text) {

    if (!groups.length) return null;

    const value = normFa(text);

    if (!value) return null;

    const titled = groups
        .map(g => ({ g, title: normFa(g.title) }))
        .filter(x => x.title.length >= 2);

    // ۱) اسم کاملِ گروه توی متنه
    const whole = titled
        .filter(x => value.includes(x.title))
        .sort((a, b) => b.title.length - a.title.length);

    if (whole.length) return whole[0].g;

    // ۲) یکی از کلمه‌های اسم گروه
    const words = new Set(value.split(" "));

    let best = null;
    let bestScore = 0;
    let tie = false;

    for (const x of titled) {

        const score = x.title.split(" ").filter(w => w.length >= 3 && words.has(w)).length;

        if (score > bestScore) {
            best = x.g;
            bestScore = score;
            tie = false;
        }
        else if (score > 0 && score === bestScore) {
            tie = true;
        }

    }

    if (best && !tie) return best;

    // اسمی نیومده: فقط وقتی حرف از گروه و دستوره حدس بزن
    if (!GROUP_ASK.test(value)) return null;

    // ۳) آخرین گروهی که ازش حرف زده بودن
    if (ownerFocus && Date.now() - ownerFocus.at < 3 * 60 * 60 * 1000) {

        const known = groups.find(g => String(g.chatId) === ownerFocus.chatId);

        if (known) return known;

    }

    // ۴) فقط یه گروه هست
    if (groups.length === 1) return groups[0];

    return null;

}

// اعضایی از گروه که مالک اسمشون (یا یوزرنیمشون) رو آورده
function findPeopleInText(text, roster, max = 4) {

    const tokens = new Set(normFa(text).split(" ").filter(Boolean));

    const found = [];

    for (const member of roster || []) {

        const names = normFa(member.name).split(" ").filter(t => t.length >= 2);

        const user = member.username ? String(member.username).toLowerCase() : null;

        const hit = names.some(t => tokens.has(t)) ||
            (user && (tokens.has("@" + user) || tokens.has(user)));

        if (hit) found.push(member);

        if (found.length >= max) break;

    }

    return found;

}

const EMPTY_OWNER_CTX = { groups: [], targetGroup: null, digest: null, people: [], roster: [] };

// همه‌ی چیزایی که روبو لازم داره تا دستورِ مالک رو توی گروهِ درست و با مایه‌ی واقعی اجرا کنه
async function buildOwnerContext(text) {

    const groups = await getKnownGroups();

    const target = resolveOwnerGroup(groups, text);

    if (!target) return Object.assign({}, EMPTY_OWNER_CTX, { groups });

    const targetId = String(target.chatId);

    ownerFocus = { chatId: targetId, at: Date.now() };

    const [messages, rosterEntry] = await Promise.all([
        getRecentGroupMessages(targetId, 30),
        getRosterCached(targetId)
    ]);

    // اول کسایی که مالک اسمشون رو آورده، بعد کسایی که تازه حرف زدن
    const ids = [];

    for (const member of findPeopleInText(text, rosterEntry.roster)) {
        ids.push(String(member.userId));
    }

    for (let i = messages.length - 1; i >= 0 && ids.length < CONFIG.PEOPLE_MAX + 4; i--) {

        const m = messages[i];

        if (m.isBot) continue;

        if (!ids.includes(String(m.userId))) ids.push(String(m.userId));

    }

    const people = await getProfiles(targetId, ids);

    people.sort((a, b) => ids.indexOf(String(a.userId)) - ids.indexOf(String(b.userId)));

    return {
        groups,
        targetGroup: target,
        digest: messages.length
            ? { title: target.title, messages: messages.slice(-25) }
            : null,
        people,
        roster: rosterEntry.roster
    };

}

// خروجی: false (نشد) | true (متن رفت) | "voice" (ویس رفت) | "voice_failed" (ویس نشد؛ چیزی توی گروه نرفت)
async function doRelay(relay, people, voiceOptions = {}) {

    try {

        const target = String(relay.chatId);

        // فقط گروه‌های شناخته‌شده
        const known = await getKnownGroups();

        if (!known.some(g => String(g.chatId) === target)) return false;

        return await enqueueResult(target, async () => {

            // مالک ویس خواسته: اگه ویس نشد، متن رو توی گروه نمی‌ذاریم؛ خودش تصمیم بگیره
            if (relay.voice) {

                if (!voice.isEnabled()) return "voice_failed";

                const stopRecording = startTyping(target, undefined, "record_voice");

                let sentVoice = null;

                try {

                    await sleep(rand(900, 1800));

                    sentVoice = await voice.speak(TOKEN, target, relay.text, {
                        replyTo: relay.replyTo || null,
                        requested: true,
                        gender: voiceOptions.gender || null
                    });

                }
                finally {

                    stopRecording();

                }

                if (!sentVoice) return "voice_failed";

                st(target).lastBotAt = Date.now();

                st(target).lastVoiceAt = Date.now();

                await saveGroupMessage({
                    chatId: target,
                    messageId: sentVoice.message_id,
                    userId: String(botInfo.id || "bot"),
                    username: botInfo.username,
                    name: "روبو",
                    text: `🎙 ${relay.text}`,
                    replyToMessageId: relay.replyTo || null,
                    isBot: true
                });

                for (const person of findMentionedPeople(relay.text, people)) {
                    openEngage(target, person.userId);
                }

                console.log("🌉🎙 VOICE RELAYED TO GROUP:", target, voiceOptions.gender || "default");

                return "voice";

            }

            const stop = startTyping(target);

            await sleep(rand(900, 2000) + Math.min(relay.text.length * 20, 2500));

            stop();

            const sent = await sendOut(target, relay.text, {
                replyTo: relay.replyTo || null
            });

            st(target).lastBotAt = Date.now();

            await saveGroupMessage({
                chatId: target,
                messageId: sent.message_id,
                userId: String(botInfo.id || "bot"),
                username: botInfo.username,
                name: "روبو",
                text: relay.text,
                replyToMessageId: relay.replyTo || null,
                isBot: true
            });

            // کسی که توی پیام اسمش اومد جواب بده، خطاب به روبو حساب می‌شه
            for (const person of findMentionedPeople(relay.text, people)) {
                openEngage(target, person.userId);
            }

            console.log("🌉 RELAYED TO GROUP:", target);

            return true;

        });

    }
    catch (error) {

        console.log("❌ RELAY ERROR:", error.message);

        return false;

    }

}

// ======================================================
// SPARK — شروع بحث توسط خود روبو
// ======================================================

let sparkTimer = null;

function startSparkLoop() {

    if (!SPARK.ENABLED || sparkTimer) return;

    sparkTimer = setInterval(() => {

        sparkTick().catch(error => console.log("❌ SPARK ERROR:", error.message));

    }, SPARK.TICK_MS);

}

async function sparkTick() {

    if (isQuietHour()) return;

    const hour = nowInfo().hour;

    if (hour < SPARK.HOURS.start || hour >= SPARK.HOURS.end) return;

    const groups = await getKnownGroups();

    for (const group of groups) {

        await maybeSpark(group).catch(
            error => console.log("❌ SPARK GROUP ERROR:", error.message)
        );

    }

}

async function maybeSpark(group) {

    const chatId = String(group.chatId);

    // حالت نظاره‌گر: خودش گپ رو باز نمی‌کنه
    if (quiet.isObserving(chatId)) return;

    const state = st(chatId);

    // وسط کار یا منتظر دخالتِ عادی
    if (state.busy > 0 || state.timer) return;

    const now = Date.now();

    state.sparkTimes = (state.sparkTimes || []).filter(t => now - t < 24 * 60 * 60 * 1000);

    if (state.sparkTimes.length >= SPARK.MAX_PER_DAY) return;

    if (now - state.lastBotAt < SPARK.MIN_GAP_MS) return;

    if (Math.random() > SPARK.CHANCE) return;

    const recent = await getRecentGroupMessages(chatId, 12);

    if (recent.length < 3) return;

    const last = recent[recent.length - 1];

    // آخرین حرف مال خودش بوده و کسی جواب نداده: دوباره نیاد
    if (last.isBot) return;

    const silence = now - new Date(last.createdAt).getTime();

    if (silence < SPARK.SILENCE_MIN_MS || silence > SPARK.SILENCE_MAX_MS) return;

    state.sparkTimes.push(now);

    console.log("✨ SPARK:", chatId, Math.round(silence / 60000), "min silence");

    enqueue(chatId, () =>
        respond({
            chatId,
            info: {
                messageId: last.messageId,
                userId: null,
                username: null,
                name: "گروه",
                chatType: group.type || "supergroup",
                title: group.title || null,
                threadId: undefined,
                text: "",
                kind: "spark",
                replyToUserId: null,
                isNew: false,
                absentHours: null,
                silenceMin: silence / 60000
            },
            trigger: "none",
            cleanText: "",
            newName: null
        })
    );

}

// ======================================================
// RESPOND — فکر کردن، تصمیم، ریکشن/ریپلای/استیکر
// ======================================================

async function respond(job) {

    // status.id وقتی پر می‌شه که پیامِ «دارم سرچ می‌کنم...» فرستاده شده باشه
    const status = { id: null };

    try {

        return await respondCore(job, status);

    }
    finally {

        // اگه پیام وضعیت به جواب تبدیل نشده بود (ویس، ریکشن، ignore، خطا) جمعش کن
        await dropStatus(job.chatId, status);

    }

}

async function respondCore(job, status) {

    const { chatId, info, trigger, cleanText, newName } = job;

    // حالت نظاره‌گر: کارهایی که قبل از ساکت شدن توی صف مونده بودن هم چیزی نمی‌فرستن
    if (
        info.chatType !== "private" &&
        quiet.isObserving(chatId) &&
        !(quiet.QUIET.ANSWER_DIRECT_CALLS && trigger !== "none")
    ) {
        return;
    }

    const state = st(chatId);

    const direct = trigger !== "none";

    // «ادامه‌ی گفتگو» هم مثل ریپلای به روبو نرمه: اگه مال روبو نبود ignore می‌شه، اجباری ریکشن نمی‌زنه
    const hard = direct && trigger !== "reply_to_bot" && trigger !== "followup";

    const isPrivate = info.chatType === "private";

    const stopTyping = hard
        ? startTyping(chatId, info.threadId)
        : () => { };

    // مالک توی پیوی: می‌تونه ازم بخواد توی گروه‌ها چیزی بگم
    const ownerPrivate = Boolean(info.isOwner && isPrivate);

    // ویس: requested = طرف خودش ویس خواسته | offered = روبو اگه خواست می‌تونه ویس بده
    const voiceAsk = direct ? voice.detectRequest(cleanText) : null;

    // «با صدای زن / مرد»: فقط وقتی مالک (یا هر کسی که اجازه داده شده) خواسته باشه
    const voiceGender = direct && voice.genderAllowed(info.isOwner)
        ? voice.detectGender(cleanText)
        : null;

    // کد یا پرامپت خواسته؟ (فقط یه یادآوری به مدل که توی بلاک کد بذارتش)
    const codeAsk = direct && format.wantsCode(cleanText);

    let voiceMode = "";

    if (voice.isEnabled() && (!ownerPrivate || voiceAsk === "yes") && voiceAsk !== "no" && info.kind !== "join") {

        if (voiceAsk === "yes") {
            // مالک توی پیوی: ممکنه بخواد توی گروه ویس بدی یا برای خودش
            voiceMode = ownerPrivate ? "owner" : "requested";
        }
        else if (
            !SAD_TEXT.test(String(info.text || "").replace(/\u200c/g, " ")) &&
            voice.spontaneousOffer(state)
        ) {
            voiceMode = "offered";
        }

    }

    // ویس خواسته شده ولی الان ممکن نیست (خاموشه یا کلید نیست): مدل نباید ادعا کنه فرستاده
    if (!voiceMode && voiceAsk === "yes" && info.kind !== "join") {

        voiceMode = "unavailable";

    }


    let decision = null;

    let recent = [];

    let social = { people: [], roster: [], known: 0, memberCount: null };

    let ownerCtx = EMPTY_OWNER_CTX;

    let mood = null;

let web = null;

    try {

        recent = await getRecentGroupMessages(
            chatId,
            CONFIG.CONTEXT_MESSAGES
        );

        // دخالت خودخواسته فقط وقتی سهم روبو از گروه متعادله
        if (!direct && info.kind !== "spark" && !balanceAllows(recent)) return;

        const tail = recent
            .slice(-4)
            .map(m => m.text)
            .join(" ");

        const siteContext = SITE_WORDS.test(tail)
            ? await getSiteContext().catch(() => "")
            : "";

        const userMemory = direct
            ? await getMemory(chatId, info.userId)
            : [];

        social = isPrivate
            ? { people: [], roster: [], known: 0, memberCount: null }
            : await gatherPeople(chatId, info, recent);

        const library = await media.getLibrarySummary();

        // مالک توی پیوی: گروهِ مقصد + آدم‌هاش + چند پیام آخرِ اون گروه
        if (ownerPrivate) {

            ownerCtx = await buildOwnerContext(cleanText);

        }

        // دخالت خودخواسته (بدون صدا زدن): حال‌وهوای این بار رو انتخاب کن
        if (!direct && !isPrivate) {

            mood = pickMood(info, social, recent, state);

            console.log("🎚 MOOD:", mood.key, mood.target ? mood.target.name : "");

        }

        // سرچ اینترنت: فقط وقتی مستقیم با روبو حرف می‌زنن (نه دخالت خودخواسته)
        // اگه سرچ لازم نباشه null برمی‌گرده و هیچ چیزی عوض نمی‌شه
        if (direct && info.kind !== "join" && info.kind !== "spark") {

            web = await search.lookup({
                chatId,
                text: cleanText,
                recent,
                siteTopic: SITE_WORDS.test(cleanText),
                onSearch: hard
                    ? makeSearchAnnouncer(chatId, info, isPrivate, status)
                    : null
            });

        }

        decision = await think({
            recent,
            trigger,
            event: info.kind === "join"
                ? "join"
                : info.kind === "spark"
                    ? "spark"
                    : null,
            chatType: info.chatType,
            chatTitle: info.title,
            speakerName: info.name,
            speakerId: ownerPrivate ? null : info.userId,
            userMemory,
            siteContext,
            lastBotAgoSec: state.lastBotAt
                ? Math.round((Date.now() - state.lastBotAt) / 1000)
                : null,
            nowText: nowInfo().text,
            speakerNote: speakerNoteFor(info),
            shareNote: isPrivate ? "" : shareNoteFor(recent),
            mediaNote: mediaNoteFor(state),
            groupNote: isPrivate ? "" : groupNoteFor(social),
            people: ownerPrivate ? ownerCtx.people : social.people,
            roster: ownerPrivate ? ownerCtx.roster : social.roster,
            library: library.text,
            ownerPrivate,
            groups: ownerCtx.groups,
            groupDigest: ownerCtx.digest,
            targetGroup: ownerCtx.targetGroup,
            mood,
            silenceMin: info.silenceMin,
            voiceMode,
            voiceGender,
            codeAsk,
            web
        });

    }
    finally {

        stopTyping();

    }

    // مدل جواب نداد
    if (!decision) {

        if (hard) {

            await sendOut(chatId, pick(FAIL_LINES), {
                replyTo: isPrivate ? null : info.messageId,
                threadId: info.threadId,
                editMessageId: status.id
            });

            status.id = null;

        }

        return;

    }

    // متن ساده (غیر JSON) فقط وقتی صداش زدن قابل قبوله
    if (decision.fallbackPlain && !hard) return;

    // پیام مالک (پیوی) به گروه؛ فقط وقتی مالک توی پیوی باشه
    if (decision.relay && ownerPrivate) {

        const ok = await doRelay(decision.relay, ownerCtx.people, { gender: voiceGender });

        if (!ok) {

            decision.text = "نتونستم توی اون گروه پیام بفرستم. شاید از گروه دراومدم یا اجازه‌ی نوشتن ندارم.";

        }
        else if (ok === "voice_failed") {

            const preview = String(decision.relay.text).slice(0, 300);

            decision.text = `ویسش درست نشد، برای همین چیزی توی گروه نذاشتم. (شاید متنش بلنده یا لینک و لاتین داره، یا مدل صدا خطا داد.)\n\nمتنش این بود:\n«${preview}»\n\nبگو همینو متنی بذارم یا یه جور دیگه بنویسمش؟`;

        }

    }

    let action = decision.action;

    let reaction = decision.reaction;

    // صداش زدن ولی مدل ignore گفت: حداقل یه ریکشن
    if (hard && action === "ignore") {

        action = "react";

        reaction = reaction || "👀";

    }

    if (action === "ignore") return;

    // شروع بحث فقط با جمله معنی داره (ریکشن به پیامِ چند ساعت پیش بی‌معنیه)
    if (info.kind === "spark" && action !== "reply") return;

    // ----- ریکشن -----

    const reactTarget = decision.replyTo || info.messageId;

    if ((action === "react" || action === "reply") && reaction) {

        await setReaction(chatId, reactTarget, reaction);

    }

    if (action === "react") {

        state.lastBotAt = Date.now();

        return;

    }

    // ----- استیکر / گیف -----

    const item = decision.media
        ? await pickMediaForSend(state, decision.media, direct)
        : null;

    // فقط استیکر می‌خواست ولی (فاصله‌ی مجاز نبود یا آیتم مناسب نبود): با ریکشن جمعش کن

    if (!decision.text && !item) {

        if (!reaction) {

            await setReaction(
                chatId,
                reactTarget,
                media.moodReaction(decision.media && decision.media.mood)
            );

        }

        state.lastBotAt = Date.now();

        return;

    }

    // ----- جواب -----

    let replyTo = null;

    if (!isPrivate) {

        replyTo = info.kind === "spark"
            ? null
            : trigger === "followup"
                ? (decision.replyTo || null)
                : (decision.replyTo || (direct ? info.messageId : null));

    }

    let sentAny = false;

    // ----- ویس (خواسته‌ی طرف، یا انتخابِ خودِ روبو) -----

    let voiceSent = false;

    let voiceFailed = false;

    // طرف یا مالک ویس خواسته (مالک توی پیوی فقط وقتی مدل voice=true بذاره؛ ممکنه برای گروه باشه یا فقط سوال بپرسه)
    const askedForVoice = voiceMode === "requested" || voiceMode === "owner";

    const useVoice = Boolean(decision.text) && !decision.relay && (
        voiceMode === "requested" ||
        ((voiceMode === "offered" || voiceMode === "owner") && decision.voice === true)
    );

    if (useVoice) {

        const stopRecording = startTyping(chatId, info.threadId, "record_voice");

        let sentVoice = null;

        try {

            sentVoice = await voice.speak(TOKEN, chatId, decision.text, {
                replyTo,
                threadId: info.threadId,
                requested: askedForVoice,
                gender: voiceGender
            });

        }
        finally {

            stopRecording();

        }

        // اگه ویس نشد (TTS خطا داد، متن طولانی بود...) پایین متن عادی می‌فرسته
        if (!sentVoice && askedForVoice) voiceFailed = true;

        if (sentVoice) {

            console.log("🎙 VOICE SENT:", sentVoice.message_id);

            voiceSent = true;

            // ویس رو نمی‌شه جای پیام متنی ادیت کرد؛ پیام «دارم سرچ می‌کنم» پاک می‌شه
            await dropStatus(chatId, status);

            sentAny = true;

            state.lastBotAt = Date.now();

            state.lastVoiceAt = Date.now();

            await saveGroupMessage({
                chatId,
                messageId: sentVoice.message_id,
                userId: String(botInfo.id || "bot"),
                username: botInfo.username,
                name: "روبو",
                text: `🎙 ${decision.text}`,
                replyToMessageId: replyTo,
                isBot: true
            });

        }

    }

    if (decision.text && !voiceSent) {

        // اگه جواب از روی سرچ بوده، اسم سایت‌های منبع هم زیرش میاد
        const textOut = decision.text + search.sourcesLine(web) +
            (voiceFailed ? "\n\n🎙 ویسِ این یکی درست نشد، برات متنی نوشتم" : "");

        // پیام وضعیت داریم: جواب آماده‌ست و همون پیام به جواب تبدیل می‌شه؛ مکثِ اضافه نمی‌خواد
        if (!status.id) await humanWait(chatId, info.threadId, decision.text.length, direct);

        const sent = await sendOut(chatId, textOut, {
            replyTo,
            threadId: info.threadId,
            editMessageId: status.id
        });

        status.id = null;

        console.log("✅ SENT:", sent.message_id);

        state.lastBotAt = Date.now();

        sentAny = true;

        // پیام خود روبو هم توی تاریخچه‌ی گروه ذخیره بشه

        await saveGroupMessage({
            chatId,
            messageId: sent.message_id,
            userId: String(botInfo.id || "bot"),
            username: botInfo.username,
            name: "روبو",
            text: textOut,
            replyToMessageId: replyTo,
            isBot: true
        });

    }

    if (item) {

        if (decision.text) {
            await sleep(rand(700, 1800));
        }
        else {
            await stickerWait(chatId, info.threadId);
        }

        const sentMedia = await media.sendItem(
            { tg, adminId: process.env.TELEGRAM_ADMIN_ID },
            chatId,
            item,
            {
                replyTo: decision.text ? null : replyTo,
                threadId: info.threadId
            }
        );

        if (sentMedia) {

            console.log("🎞 MEDIA SENT:", item.kind, item.mood);

            sentAny = true;

            state.lastBotAt = Date.now();

            state.lastMediaAt = Date.now();

            state.recentMedia.push(item.fileUniqueId);

            if (state.recentMedia.length > 15) state.recentMedia.shift();

            await saveGroupMessage({
                chatId,
                messageId: sentMedia.message_id,
                userId: String(botInfo.id || "bot"),
                username: botInfo.username,
                name: "روبو",
                text: media.describeItem(item),
                replyToMessageId: decision.text ? null : replyTo,
                isBot: true
            });

        }

    }

    // هیچی ارسال نشد (مثلاً فایل استیکر خراب بود)
    if (!sentAny) {

        if (!reaction) {

            await setReaction(
                chatId,
                reactTarget,
                media.moodReaction(decision.media && decision.media.mood)
            );

        }

        return;

    }

    if (!direct) {

        state.lastProactiveAt = Date.now();

        state.proactiveTimes.push(Date.now());

        // «سوژه کردن» رو بشمار تا یه نفر یا یه گروه زیر بار نره
        if (mood && (mood.key === "roast" || mood.key === "rude") && decision.text) {

            state.lastRoastAt = Date.now();

            state.lastRoastUserId = mood.target ? String(mood.target.userId) : null;

        }

    }

    // طرفِ گفتگو رو «درگیر» نگه دار تا لازم نباشه دوباره اسم روبو رو بیاره
    if (!isPrivate && decision.text) {

        if (direct) {

            touchEngage(chatId, info.userId);

        }
        else {

            const targets = new Set();

            if (mood && mood.target) targets.add(String(mood.target.userId));

            if (decision.replyTo) {

                const replied = recent.find(
                    m => Number(m.messageId) === Number(decision.replyTo)
                );

                if (replied && !replied.isBot) targets.add(String(replied.userId));

            }

            for (const person of findMentionedPeople(decision.text, social.people)) {
                targets.add(String(person.userId));
            }

            targets.forEach(id => openEngage(chatId, id));

        }

    }

    // حافظه‌ی کاربر (مثل قبل) فقط وقتی مستقیم باهاش حرف زدن

    if (direct) {

        await saveMemory({
            chatId,
            userId: info.userId,
            username: info.username,
            name: newName || null,
            message: cleanText,
            answer: decision.text || (item ? media.describeItem(item) : "")
        });

    }

}

// ======================================================
// MESSAGE CONTENT
// متن، یا یه توصیف کوتاه برای استیکر/گیف/عکس/... تا توی تاریخچه‌ی گروه
// ببینمش (محتوای عکس و ویدیو و ویس دیده نمی‌شه، فقط وجودش)
// ======================================================

function extractContent(msg) {

    const plain = (msg.text || msg.caption || "").trim();

    let kind = "text";

    let label = "";

    if (msg.sticker) {

        kind = "sticker";

        label = `استیکر${msg.sticker.emoji ? " " + msg.sticker.emoji : ""}`;

    }
    else if (msg.animation || (msg.document && /image\/gif/i.test(msg.document.mime_type || ""))) {

        kind = "gif";

        label = "گیف";

    }
    else if (msg.photo) {

        kind = "photo";

        label = "عکس";

    }
    else if (msg.video) {

        kind = "video";

        label = "ویدیو";

    }
    else if (msg.video_note) {

        kind = "video_note";

        label = "ویدیو مسیج";

    }
    else if (msg.voice) {

        kind = "voice";

        label = "ویس";

    }
    else if (msg.audio) {

        kind = "audio";

        label = "آهنگ";

    }
    else if (msg.document) {

        kind = "document";

        const fileName = String(msg.document.file_name || "").slice(0, 40);

        label = fileName ? `فایل: ${fileName}` : "فایل";

    }
    else if (msg.poll) {

        kind = "poll";

        label = `نظرسنجی: ${String(msg.poll.question || "").slice(0, 60)}`;

    }

    const placeholder = label ? `[${label}]` : "";

    return {
        plain,
        kind,
        placeholder,
        full: `${placeholder} ${plain}`.trim()
    };

}

// ======================================================
// NEW MEMBERS
// ======================================================

async function onJoin(msg) {

    if (msg.chat.type === "private") return;

    const members = (msg.new_chat_members || []).filter(u => !u.is_bot);

    if (!members.length) return;

    const chatId = String(msg.chat.id);

    registerGroup(msg.chat);

    for (const user of members) {

        await touchMember({
            chatId,
            userId: String(user.id),
            username: user.username || null,
            name: user.first_name || user.username || "کاربر",
            soft: true
        });

    }

    const first = members[0];

    const name = first.first_name || first.username || "کاربر";

    const text = `[${name} تازه وارد گروه شد]`;

    await saveGroupMessage({
        chatId,
        messageId: msg.message_id,
        userId: String(first.id),
        username: first.username || null,
        name,
        text,
        replyToMessageId: null,
        isBot: false
    });

    if (Date.now() / 1000 - msg.date > CONFIG.STALE_SECONDS) return;

    if (isQuietHour()) return;

    scheduleProactive(chatId, {
        messageId: msg.message_id,
        userId: String(first.id),
        username: first.username || null,
        name,
        chatType: msg.chat.type,
        title: msg.chat.title || null,
        threadId: msg.is_topic_message ? msg.message_thread_id : undefined,
        text,
        kind: "join",
        replyToUserId: null,
        isNew: true,
        absentHours: null
    });

}

// ======================================================
// MESSAGE HANDLER
// ======================================================

async function onMessage(msg) {

    try {

        if (msg.new_chat_members) return await onJoin(msg);

        if (!msg.from || msg.from.is_bot) return;

        const content = extractContent(msg);

        if (!content.full) return;

        // دستورات اسلش (/start و ...) نادیده
        if (content.plain.startsWith("/")) return;

        const isPrivate = msg.chat.type === "private";

        // ==========================================
        // استیکر / پک / گیفی که کسی پیوی می‌فرسته:
        // برداشته می‌شه و بعداً توی گروه‌ها استفاده می‌شه
        // ==========================================

        if (isPrivate) {

            // دستورهای مدیریتیِ مالک (گیف/استیکرِ ممنوع، حذف/سکوتِ متخلف)؛
            // فقط از روی آیدی/یوزرنیمِ تلگرام تأیید می‌شه (checkOwner)
            if (checkOwner(msg.from)) {

                const moderated = await moderation.handleOwnerMessage(msg);

                if (moderated) return;

            }

            const handled = await media.handleIncoming(
                { tg, adminId: process.env.TELEGRAM_ADMIN_ID },
                msg
            );

            if (handled) return;

        }

        // ==========================================
        // دستورات فایل (مستقل از روبو)
        // ==========================================

        const text = content.plain;

        if (content.kind === "text" && text === "لیست فایل ها") {

            const files = getFiles();

            if (files.length === 0) {
                return send(msg.chat.id, "❌ فایلی وجود ندارد");
            }

            let result = "📁 فایل‌ها:\n\n";

            files.forEach((file, index) => {
                result += `${index + 1}️⃣ ${file}\n`;
            });

            return send(msg.chat.id, result);

        }

        // دریافت فایل
        const fileMatch = content.kind === "text"
            ? text.match(/دریافت\s+(\d+)/)
            : null;

        if (fileMatch) {

            const index = Number(fileMatch[1]) - 1;

            const file = getFiles()[index];

            if (!file) {
                return send(msg.chat.id, "❌ فایل پیدا نشد");
            }

            return bot.sendDocument(
                msg.chat.id,
                path.join(FILE_DIR, file)
            );

        }

        // ==========================================
        // آماده‌سازی
        // ==========================================

        const chatId = String(msg.chat.id);

        const userId = String(msg.from.id);

        const username = msg.from.username || null;

        const trigger = getTrigger(msg, text);

        const direct = trigger !== "none";

        const cleanedPlain = direct ? cleanMessage(text) : text;

        // متنی که مدل می‌بینه (برای استیکر/عکس: توصیفش + کپشن)
        const cleanText = direct
            ? `${content.placeholder} ${cleanedPlain}`.trim()
            : content.full;

        const suspicious = text
            ? (isBinaryMessage(text) || isPromptInjection(cleanedPlain))
            : false;

        const displayName = await resolveName(chatId, userId, msg.from);

        // گیف / استیکرِ ممنوع توی گروه: پاک می‌شه، اخطار می‌ره و ادامه‌ی منطق اجرا نمی‌شه
        // (مالک معاف)
        if (!isPrivate && !checkOwner(msg.from)) {

            const banned = await moderation.enforceMedia(msg, displayName);

            if (banned) return;

        }

        // ==========================================
        // شناخت عضو (فقط گروه‌ها): شمارنده‌ها + تحلیل دوره‌ای
        // ==========================================

        let before = null;

        if (!isPrivate) {

            primeGroup(msg.chat).catch(() => { });

            registerGroup(msg.chat);

            const meta = chatMeta.get(chatId);

            const role = meta && meta.ready
                ? (meta.admins.get(userId) || "member")
                : undefined;

            const cls = profiler.classify(text);

            before = await touchMember({
                chatId,
                userId,
                username,
                name: displayName,
                role,
                hour: nowInfo().hour,
                isText: content.kind === "text",
                textLen: cls.len,
                laugh: cls.laugh,
                question: cls.question,
                curse: cls.curse,
                media: content.kind === "sticker" || content.kind === "gif"
            });

            if (profiler.shouldAnalyze(before)) {

                profiler.queueAnalysis(chatId, userId);

            }

        }

        const info = {
            messageId: msg.message_id,
            userId,
            username,
            name: displayName,
            chatType: msg.chat.type,
            title: msg.chat.title || null,
            threadId: msg.is_topic_message ? msg.message_thread_id : undefined,
            text: cleanText,
            kind: content.kind,
            replyToUserId: msg.reply_to_message && msg.reply_to_message.from
                ? String(msg.reply_to_message.from.id)
                : null,
            isNew: !isPrivate && !before,
            isOwner: checkOwner(msg.from),
            absentHours: before && before.lastSeenAt
                ? (Date.now() - new Date(before.lastSeenAt).getTime()) / 3600000
                : null
        };

        console.log("📩 MESSAGE:", trigger, "|", content.full);

        // پیامِ یه نفر دیگه یعنی گفتگوهای بازِ بقیه یه قدم دورتر شد
        if (!isPrivate) bumpOthers(chatId, userId);

        // ==========================================
        // ذخیره در تاریخچه‌ی گروه (همه‌ی پیام‌ها)
        // پیام مشکوک به‌جای متن اصلی ذخیره می‌شه
        // ==========================================

        await saveGroupMessage({
            chatId,
            messageId: msg.message_id,
            userId,
            username,
            name: displayName,
            text: suspicious ? "[پیام مشکوک؛ حذف شد]" : content.full,
            replyToMessageId: msg.reply_to_message
                ? msg.reply_to_message.message_id
                : null,
            isBot: false
        });

        // تمسخرِ نظام/آخوند/ارزشی‌ها: بی‌صدا بررسی می‌شه و اگه واقعاً بود، به مالک خبر می‌ره
        // (توی حالت نظاره‌گر هم کار می‌کنه؛ مالک معاف)
        if (!isPrivate && !info.isOwner && content.plain) {

            moderation.inspectText(msg, displayName);

        }

        // بعد از ری‌استارت به پیام‌های قدیمی جواب نده
        if (Date.now() / 1000 - msg.date > CONFIG.STALE_SECONDS) return;

        // ==========================================
        // حالت نظاره‌گر (فقط گروه‌ها)
        //  «روبو فعلاً وارد بحث نشو / ساکت باش» → فقط می‌خونه
        //  «روبو بیا / حرف بزن» → برمی‌گرده
        // ==========================================

        if (!isPrivate) {

            if (direct && !suspicious && content.kind === "text") {

                const command = quiet.detectCommand(cleanedPlain);

                const replyOptions = { replyTo: msg.message_id, threadId: info.threadId };

                if (command === "observe") {

                    // قبلاً ساکت شده؛ بی‌صدا رد شو
                    if (quiet.isObserving(chatId)) return;

                    quiet.start(chatId, userId);

                    setGroupObserving(chatId, true).catch(() => { });

                    // کارهای نیمه‌کاره‌ی این گروه کنسل
                    const groupState = st(chatId);

                    if (groupState.timer) {
                        clearTimeout(groupState.timer);
                        groupState.timer = null;
                    }

                    groupState.engaged.clear();

                    console.log("👀 OBSERVE MODE ON:", chatId, userId);

                    return enqueue(chatId, () =>
                        sendOut(chatId, pick(OBSERVE_ON_LINES), replyOptions)
                    );

                }

                if (command === "resume" && quiet.isObserving(chatId)) {

                    quiet.stop(chatId);

                    setGroupObserving(chatId, false).catch(() => { });

                    console.log("🔊 OBSERVE MODE OFF:", chatId, userId);

                    return enqueue(chatId, () =>
                        sendOut(chatId, pick(OBSERVE_OFF_LINES), replyOptions)
                    );

                }

            }

            if (quiet.isObserving(chatId) && !(quiet.QUIET.ANSWER_DIRECT_CALLS && direct)) {

                // «منو فراموش کن» حتی وقتی ساکته اجرا می‌شه (بی‌صدا؛ فقط یه ریکشن)
                if (direct && !suspicious && profiler.isForgetRequest(cleanedPlain)) {

                    await forgetMember(chatId, userId);

                    nameCache.delete(chatId + ":" + userId);

                    rosterCache.delete(chatId);

                    await setReaction(chatId, msg.message_id, "👌");

                }

                // بقیه‌ی پیام‌ها: فقط خونده می‌شن (قبلاً توی تاریخچه و پروفایل ثبت شدن)
                return;

            }

        }

        // ==========================================
        // خطاب مستقیم به روبو
        // ==========================================

        if (direct) {

            const replyTo = msg.chat.type === "private" ? null : msg.message_id;

            // صدا زدن مستقیم: از این لحظه پیام‌های بعدیِ همین آدم هم خطاب به روبو حساب می‌شه
            // (حتی اگه فقط نوشته «روبو» و سوالش رو توی پیام بعدی می‌گه)
            if (!isPrivate && trigger !== "followup" && !suspicious) {
                openEngage(chatId, userId);
            }

            if (!cleanText) {

                if (trigger === "followup") return;

                return enqueue(chatId, () =>
                    sendOut(chatId, pick(EMPTY_CALL_LINES), {
                        replyTo,
                        threadId: info.threadId
                    })
                );

            }

            // ضد باینری و prompt injection
            if (suspicious) {

                console.log("🚫 SUSPICIOUS MESSAGE BLOCKED:", cleanText);

                // ادامه‌ی گفتگو بود و مشکوک؟ بی‌صدا رد شو
                if (trigger === "followup") return;

                return enqueue(chatId, () =>
                    sendOut(chatId, pick(BLOCK_LINES), {
                        replyTo,
                        threadId: info.threadId
                    })
                );

            }

            // «منو فراموش کن»: پروفایل، حافظه و پیام‌های همین آدم پاک می‌شه
            if (profiler.isForgetRequest(cleanedPlain)) {

                const result = await forgetMember(chatId, userId);

                nameCache.delete(chatId + ":" + userId);

                rosterCache.delete(chatId);

                closeEngage(chatId, userId);

                console.log("🧹 FORGOTTEN:", chatId, userId, result);

                return enqueue(chatId, () =>
                    sendOut(chatId, pick(FORGET_LINES), {
                        replyTo,
                        threadId: info.threadId
                    })
                );

            }

            // «کل پک استیکرت رو حذف کن»: فقط برای مالکِ تأییدشده اجرا می‌شه
            // (اگه کس دیگه‌ای بگه، یه جوابِ ثابتِ «فقط مالک» می‌گیره)
            if (
                trigger !== "followup" &&
                content.kind === "text" &&
                media.isStickerWipeRequest(cleanedPlain)
            ) {

                const wipeAnswer = await media.handleStickerWipe(info.isOwner);

                console.log("🗑 STICKER WIPE REQUEST:", userId, info.isOwner ? "owner" : "denied");

                return enqueue(chatId, () =>
                    sendOut(chatId, wipeAnswer, {
                        replyTo,
                        threadId: info.threadId
                    })
                );

            }

            // لینک سایت
            const lowerText = cleanText.toLowerCase();

            if (
                lowerText.includes("لینک سایت") ||
                lowerText.includes("آدرس سایت") ||
                lowerText.includes("سایت رو بده")
            ) {

                return enqueue(chatId, () =>
                    sendOut(
                        chatId,
                        `🌐 لینک سایت:

https://vfebhebrb-sudo.github.io/Riseo/


هر وقت خواستی بگو:
«روبو لینک سایت رو بده»`,
                        { replyTo, threadId: info.threadId }
                    )
                );

            }

            // درخواست خودش برای لحن («با من ملایم‌تر باش» / «فحشم بده»)
            if (!isPrivate) {

                const tone = profiler.detectToneRequest(cleanedPlain);

                if (tone === "mild") {
                    await setMemberFlags(chatId, userId, { noTeasing: true });
                }
                else if (tone === "spicy") {
                    await setMemberFlags(chatId, userId, { noTeasing: false });
                }

            }

            // تشخیص اسم
            const detectedName = extractName(cleanedPlain);

            if (detectedName) {

                console.log("🧠 NEW NAME:", detectedName);

                nameCache.set(chatId + ":" + userId, {
                    name: detectedName,
                    at: Date.now()
                });

                info.name = detectedName;

            }

            const job = {
                chatId,
                info,
                trigger,
                cleanText,
                newName: detectedName
            };

            // ادامه‌ی گفتگو: چند پیام پشت‌سرهم یه جواب می‌گیره
            if (trigger === "followup") {
                return scheduleFollowup(chatId, userId, job);
            }

            return enqueue(chatId, () => respond(job));

        }

        // ==========================================
        // پیام بی‌خطاب توی گروه: شاید دخالت کنه
        // ==========================================

        if (msg.chat.type !== "private" && !suspicious) {

            scheduleProactive(chatId, info);

        }

    }
    catch (error) {

        console.log("❌ ROBO MESSAGE ERROR:", error.message);

    }

}

// ======================================================
// START BOT
// ======================================================

function startBot() {

    if (!TOKEN) {

        console.log("❌ TELEGRAM TOKEN MISSING");

        return;

    }

    bot = new TelegramBot(TOKEN, { polling: true });

    moderation.init({
        tg,
        getOwnerId: () => ownerId,
        isOwner: from => checkOwner(from)
    });

    console.log("🤖 ROBO STARTED");

    // گروه‌هایی که ساکتشون کردن (بعد از ری‌استارت هم ساکت می‌مونن)
    const observeLoaded = getObservingChatIds()
        .then(ids => {

            quiet.load(ids);

            if (ids.length) console.log("👀 OBSERVING GROUPS:", ids.length);

        })
        .catch(error => console.log("OBSERVE LOAD ERROR:", error.message));

    const ready = bot.getMe()
        .then(me => {

            botInfo = { id: me.id, username: me.username || "" };

            console.log("CONNECTED:", me.username);

        })
        .catch(error => {

            console.log("GETME ERROR:", error.message);

        });

    Promise.all([ready, observeLoaded]).then(startSparkLoop);

    ready.then(() => voice.diagnose());

    bot.on("message", async msg => {

        await ready;

        await observeLoaded;

        await onMessage(msg);

    });

    // دکمه‌های اینلاین (انتخاب حال‌وهوای گیف، حذف توسط ادمین)
    bot.on("callback_query", query => {

        // دکمه‌های گزارشِ مدیریت (حذف / سکوت / اخطار)
        if (moderation.isCallback(query)) {

            moderation
                .onCallback(query)
                .catch(error => console.log("❌ MODERATION CALLBACK ERROR:", error.message));

            return;

        }

        media
            .onCallback({ tg, adminId: process.env.TELEGRAM_ADMIN_ID }, query)
            .catch(error => console.log("❌ CALLBACK ERROR:", error.message));

    });

    bot.on("polling_error", error => {

        console.log("POLLING ERROR:", error.message);

    });

}

// ======================================================
// NEW FILE NOTIFY
// ======================================================

async function notifyNewFile(data) {

    try {

        const chat = process.env.TELEGRAM_ADMIN_ID;

        if (!chat) return;

        const text = `

📥 فایل جدید سایت


📄 ${data.name}


📚 ${data.lesson || "نامشخص"}


📦 ${data.size} bytes


🤖 Riseo File Bot

`;

        await bot.sendMessage(chat, text);

        console.log("✅ NEW FILE SENT");

    }
    catch (error) {

        console.log("❌ NOTIFY ERROR:", error.message);

    }

}

module.exports = {

    startBot,

    notifyNewFile

};