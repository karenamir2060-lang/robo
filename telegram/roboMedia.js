// ======================================================
// ROBO MEDIA — کتابخونه‌ی استیکر و گیف روبو
//
// - کسی توی پیوی استیکر / پک استیکر / لینک پک / گیف بفرسته، روبو برمی‌داردش
//   (file_id تلگرام ذخیره می‌شه؛ لازم نیست فایل دانلود بشه، تلگرام خودش نگه می‌داره)
// - هر آیتم یه «حال‌وهوا» (mood) داره؛ مدل فقط حال‌وهوا رو می‌گه
//   و همین‌جا یه آیتم مناسب انتخاب می‌شه
// - اگه TELEGRAM_ADMIN_ID ست باشه، هر گیف/پکِ تازه برای ادمین هم فرستاده می‌شه
//   با دکمه‌ی «حذف» (چون محتوای پیوی کنترل‌شده نیست)
// ======================================================

const {
    addMediaItems,
    findMediaByUnique,
    mediaSetExists,
    setMediaMood,
    pickMediaItem,
    touchMediaUse,
    deleteMediaItem,
    deleteMediaSet,
    deleteAllStickers,
    countUserMedia,
    getMediaStats
} = require("../services/roboMemoryService");

// گیف/استیکر/پکی که مالک ممنوع کرده؛ نه ذخیره می‌شه نه ازش استفاده می‌شه
const moderation = require("./roboModeration");

// ======================================================
// CONFIG
// ======================================================

const LIMITS = {

    // سهمیه‌ی هر کاربر (ادمین نامحدوده)
    MAX_GIFS_PER_USER: 60,
    MAX_PACKS_PER_USER: 6,

    // از هر پک حداکثر چندتا برداشته بشه
    MAX_PACK_STICKERS: 150,

    // سقف کل کتابخونه
    MAX_LIBRARY: 4000,

    LIBRARY_CACHE_MS: 3 * 60 * 1000

};

// ======================================================
// MOODS
// ======================================================

const MOODS = {
    laugh: { label: "😂 خنده", reaction: "🤣" },
    love: { label: "🥰 محبت", reaction: "🥰" },
    cool: { label: "🗿 خونسرد", reaction: "🗿" },
    hype: { label: "🔥 تحسین / جشن", reaction: "🔥" },
    sad: { label: "😢 غم / همدردی", reaction: "😢" },
    shock: { label: "😱 تعجب", reaction: "😱" },
    roast: { label: "😈 شیطنت / تیکه", reaction: "😈" },
    angry: { label: "😡 عصبانی", reaction: "😡" },
    bored: { label: "🥱 حوصله‌سربر", reaction: "🥱" },
    think: { label: "🤔 فکر / شک", reaction: "🤔" },
    hello: { label: "👋 سلام", reaction: "🤗" },
    ok: { label: "👍 تأیید", reaction: "👍" },
    misc: { label: "🎲 بی‌دسته", reaction: "👀" }
};

const MOOD_KEYS = Object.keys(MOODS);

// ایموجی استیکر → حال‌وهوا

const EMOJI_GROUPS = {
    laugh: "😂🤣😹😆😁😄😃😀😅🤭😝😜🤪😛",
    love: "❤🥰😍😘💕💖💗💘😻🫶🤗💋😚💞",
    cool: "😎🗿😏😌🤙🧊",
    hype: "🔥🎉👏🏆🤩💯🥳🙌👑✨🎊🚀💪🎆",
    sad: "😢😭💔😞😔🥺😿☹🙁😪😓",
    shock: "😱🤯😨😳😲😮🙀😵😧",
    roast: "😈🤡🤨🙄😒🤏🤥👹",
    angry: "😡🤬😠👿💢👎",
    bored: "🥱😴😑😐🙃💤😶",
    think: "🤔👀🧠🤓🧐",
    hello: "👋✋🙋🖐",
    ok: "👍👌🫡✅🙏🤝"
};

const EMOJI_TO_MOOD = new Map();

for (const [mood, chars] of Object.entries(EMOJI_GROUPS)) {

    for (const ch of Array.from(chars)) {

        if (ch !== "\uFE0F") EMOJI_TO_MOOD.set(ch, mood);

    }

}

function stripEmoji(value) {

    return String(value || "").replace(/\uFE0F|[\u{1F3FB}-\u{1F3FF}]/gu, "");

}

function emojiToMood(emoji) {

    for (const ch of Array.from(stripEmoji(emoji))) {

        if (EMOJI_TO_MOOD.has(ch)) return EMOJI_TO_MOOD.get(ch);

    }

    return "misc";

}

// کپشنی که موقع فرستادن گیف نوشته شده («خنده»، «گریه»...)

const TEXT_MOODS = [
    ["laugh", /خنده|جوک|ههه|lol|lmao|funny|haha/i],
    ["love", /محبت|عشق|دوستت|قلب|love/i],
    ["sad", /غم|گریه|ناراحت|دلتنگ|sad|cry/i],
    ["angry", /عصبان|خشم|دعوا|angry|mad/i],
    ["shock", /تعجب|شوک|وای|shock|wtf|omg/i],
    ["hype", /تبریک|جشن|آفرین|عالی|ایول|congrat|party|hype/i],
    ["roast", /تیکه|شیطن|رست|roast/i],
    ["cool", /خونسرد|باحال|کول|cool/i],
    ["bored", /حوصله|خواب|خسته|boring|sleep/i],
    ["think", /فکر|شک|hmm|think/i],
    ["hello", /سلام|hello|hi\b|hey/i],
    ["ok", /تایید|تأیید|باشه|اوکی|ok\b|yes/i]
];

function moodFromText(text) {

    const value = String(text || "");

    if (!value.trim()) return "misc";

    const byEmoji = emojiToMood(value);

    if (byEmoji !== "misc") return byEmoji;

    for (const [mood, regex] of TEXT_MOODS) {

        if (regex.test(value)) return mood;

    }

    return "misc";

}

function moodReaction(mood) {

    return (MOODS[mood] || MOODS.misc).reaction;

}

// ======================================================
// TEXTS
// ======================================================

const pick = list => list[Math.floor(Math.random() * list.length)];

const LINES = {

    gifSaved: [
        "گرفتمش 😎 جاش که بیاد تو گروه می‌ترکونم.",
        "جیگرته، به کلکسیونم اضافه شد 😈",
        "این یکی رو نگه می‌دارم، یه جا لازمش می‌شم.",
        "عالیه، کتابخونه‌م داره باکلاس می‌شه 😁"
    ],

    gifDuplicate: [
        "این رو از قبل داشتم 😅 یه چیز جدید بیار.",
        "تکراریه رفیق، سلیقه‌هامون یکیه 😄"
    ],

    stickerSaved: [
        "استیکرت رو برداشتم 😎",
        "قشنگه، اضافه شد به کلکسیون 😈"
    ],

    stickerDuplicate: [
        "این استیکر رو از قبل داشتم 😅",
        "تکراریه، ولی سلیقه‌ت خوبه 😁"
    ],

    packDuplicate: [
        "این پک از قبل پیشمه 😎 یه پک دیگه بیار.",
        "همین پک رو دارم، یکی جدید بده 😄"
    ],

    quota: "سهمیه‌ی خودت پر شده، رفیق 😅 دیگه جا ندارم برات.",

    full: "کتابخونه‌م دیگه جا نداره، از ادمین بخواه جا باز کنه.",

    unsupported: "این نوع استیکر (ایموجی سفارشی یا ماسک) رو نمی‌تونم بفرستم 😕",

    packFail: "نتونستم این پک رو باز کنم؛ مطمئنی لینکش درسته؟",

    banned: "این یکی ممنوعه 🚫 برش نمی‌دارم."

};

// ======================================================
// LIBRARY SUMMARY (برای پرامپت مدل؛ کش‌شده)
// ======================================================

let libraryCache = { at: 0, value: null };

function invalidateLibraryCache() {

    libraryCache = { at: 0, value: null };

}

function formatMoods(map) {

    const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]);

    if (!entries.length) return "ندارم";

    return entries.map(([mood, n]) => `${mood}×${n}`).join("، ");

}

async function getLibrarySummary() {

    if (
        libraryCache.value &&
        Date.now() - libraryCache.at < LIMITS.LIBRARY_CACHE_MS
    ) {
        return libraryCache.value;
    }

    const stats = await getMediaStats();

    const value = {
        total: stats.total,
        text: stats.total
            ? `استیکر: ${formatMoods(stats.sticker)} | گیف: ${formatMoods(stats.gif)}`
            : "خالیه؛ استیکر و گیف نداری، پس media نخواه."
    };

    libraryCache = { at: Date.now(), value };

    return value;

}

// ======================================================
// PICK + SEND
// ======================================================

async function pickForSend(kind, mood, excludeUniqueIds) {

    if (!["sticker", "gif"].includes(kind)) return null;

    const wanted = MOOD_KEYS.includes(mood) ? mood : "misc";

    // ممنوع‌شده‌ها هیچ‌وقت انتخاب نمی‌شن (حتی اگه قبل از ممنوع شدن ذخیره شده باشن)
    const excluded = (excludeUniqueIds || []).concat(moderation.bannedUniqueIds());

    return pickMediaItem(kind, wanted, excluded);

}

// برمی‌گردونه پیام ارسال‌شده؛ اگه فایل خراب بود حذفش می‌کنه و null می‌ده

async function sendItem(deps, chatId, item, options = {}) {

    const body = { chat_id: chatId };

    if (options.replyTo) {
        body.reply_to_message_id = options.replyTo;
        body.allow_sending_without_reply = true;
    }

    if (options.threadId) body.message_thread_id = options.threadId;

    try {

        const sent = item.kind === "sticker"
            ? await deps.tg("sendSticker", { ...body, sticker: item.fileId })
            : await deps.tg("sendAnimation", { ...body, animation: item.fileId });

        touchMediaUse(item.fileUniqueId);

        return sent;

    }
    catch (error) {

        console.log("❌ MEDIA SEND ERROR:", error.message);

        if (/wrong file identifier|wrong file_id|wrong remote file|invalid file|file reference/i.test(error.message)) {

            await deleteMediaItem(item.fileUniqueId);

            invalidateLibraryCache();

        }

        return null;

    }

}

// متن placeholder که توی تاریخچه‌ی گروه ذخیره می‌شه

function describeItem(item) {

    if (item.kind === "sticker") {

        return `[استیکر${item.emoji ? " " + item.emoji : ""}]`;

    }

    return "[گیف]";

}

// ======================================================
// INCOMING (پیوی)
// ======================================================

const PACK_LINK = /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/addstickers\/([A-Za-z0-9_]+)/i;

function isAdmin(adminId, userId) {

    return Boolean(adminId) && String(adminId) === String(userId);

}

function gifFrom(msg) {

    if (msg.animation) return msg.animation;

    if (msg.document && /image\/gif/i.test(msg.document.mime_type || "")) {
        return msg.document;
    }

    return null;

}

function moodKeyboard(uniqueId) {

    const keys = MOOD_KEYS.filter(m => m !== "misc");

    const rows = [];

    for (let i = 0; i < keys.length; i += 3) {

        rows.push(
            keys.slice(i, i + 3).map(mood => ({
                text: MOODS[mood].label,
                callback_data: `mm|${mood}|${uniqueId}`
            }))
        );

    }

    return { inline_keyboard: rows };

}

async function reply(deps, msg, text, extra = {}) {

    try {

        await deps.tg("sendMessage", {
            chat_id: msg.chat.id,
            text,
            ...extra
        });

    }
    catch (error) {

        console.log("❌ MEDIA REPLY ERROR:", error.message);

    }

}

async function notifyAdmin(deps, kind, payload) {

    if (!deps.adminId) return;

    try {

        if (kind === "gif") {

            await deps.tg("sendAnimation", {
                chat_id: deps.adminId,
                animation: payload.item.fileId,
                caption: `🆕 گیف جدید از ${payload.by}`,
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🗑 حذف", callback_data: `md|${payload.item.fileUniqueId}` }
                    ]]
                }
            });

        }
        else if (kind === "pack") {

            await deps.tg("sendMessage", {
                chat_id: deps.adminId,
                text:
                    `🆕 پک استیکر جدید از ${payload.by}\n` +
                    `${payload.title} (${payload.added} تا)\n` +
                    `https://t.me/addstickers/${payload.setName}`,
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🗑 حذف کل پک", callback_data: `mdp|${payload.firstUniqueId}` }
                    ]]
                }
            });

        }
        else if (kind === "sticker") {

            await deps.tg("sendSticker", {
                chat_id: deps.adminId,
                sticker: payload.item.fileId,
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🗑 حذف (از " + payload.by + ")", callback_data: `md|${payload.item.fileUniqueId}` }
                    ]]
                }
            });

        }

    }
    catch (error) {

        console.log("❌ MEDIA ADMIN NOTIFY ERROR:", error.message);

    }

}

async function importPack(deps, msg, setName, admin) {

    const user = msg.from;

    const by = user.first_name || user.username || "یه نفر";

    if (await mediaSetExists(setName)) {

        await reply(deps, msg, pick(LINES.packDuplicate));

        return true;

    }

    const stats = await getMediaStats();

    if (!admin && stats.total >= LIMITS.MAX_LIBRARY) {

        await reply(deps, msg, LINES.full);

        return true;

    }

    if (!admin) {

        const mine = await countUserMedia(user.id);

        if (mine.packs >= LIMITS.MAX_PACKS_PER_USER) {

            await reply(deps, msg, LINES.quota);

            return true;

        }

    }

    let set;

    try {

        set = await deps.tg("getStickerSet", { name: setName });

    }
    catch (error) {

        console.log("❌ STICKER SET ERROR:", error.message);

        await reply(deps, msg, LINES.packFail);

        return true;

    }

    const usable = (set.stickers || [])
        .filter(s => s.file_id && s.file_unique_id)
        .filter(s => !s.type || s.type === "regular")
        .slice(0, LIMITS.MAX_PACK_STICKERS);

    if (!usable.length) {

        await reply(deps, msg, LINES.unsupported);

        return true;

    }

    const items = usable.map(s => ({
        kind: "sticker",
        fileId: s.file_id,
        fileUniqueId: s.file_unique_id,
        mood: emojiToMood(s.emoji),
        emoji: s.emoji || null,
        setName: set.name || setName,
        setTitle: set.title || null,
        addedBy: user.id,
        addedByName: by
    }));

    const result = await addMediaItems(items);

    invalidateLibraryCache();

    await reply(
        deps,
        msg,
        `پک «${set.title || setName}» رو برداشتم 🎁\n` +
        `${result.added} تا استیکر اضافه شد` +
        (result.added < items.length ? ` (${items.length - result.added} تاش از قبل بود)` : "") +
        `.\nهر کدوم رو با ایموجیش جای مناسبش استفاده می‌کنم 😎`
    );

    if (!admin && result.added > 0) {

        await notifyAdmin(deps, "pack", {
            by,
            title: set.title || setName,
            setName: set.name || setName,
            added: result.added,
            firstUniqueId: items[0].fileUniqueId
        });

    }

    return true;

}

async function handleSticker(deps, msg, admin) {

    const sticker = msg.sticker;

    const user = msg.from;

    if (sticker.type && sticker.type !== "regular") {

        await reply(deps, msg, LINES.unsupported);

        return true;

    }

    // استیکرِ داخل یه پک: کل پک رو برمی‌داره

    if (sticker.set_name) {

        return importPack(deps, msg, sticker.set_name, admin);

    }

    // استیکر تکی (بدون پک)

    if (await findMediaByUnique(sticker.file_unique_id)) {

        await reply(deps, msg, pick(LINES.stickerDuplicate));

        return true;

    }

    const by = user.first_name || user.username || "یه نفر";

    const item = {
        kind: "sticker",
        fileId: sticker.file_id,
        fileUniqueId: sticker.file_unique_id,
        mood: emojiToMood(sticker.emoji),
        emoji: sticker.emoji || null,
        setName: null,
        addedBy: user.id,
        addedByName: by
    };

    await addMediaItems([item]);

    invalidateLibraryCache();

    await reply(deps, msg, pick(LINES.stickerSaved));

    if (!admin) await notifyAdmin(deps, "sticker", { by, item });

    return true;

}

async function handleGif(deps, msg, gif, admin) {

    const user = msg.from;

    if (await findMediaByUnique(gif.file_unique_id)) {

        await reply(deps, msg, pick(LINES.gifDuplicate));

        return true;

    }

    if (!admin) {

        const stats = await getMediaStats();

        if (stats.total >= LIMITS.MAX_LIBRARY) {

            await reply(deps, msg, LINES.full);

            return true;

        }

        const mine = await countUserMedia(user.id);

        if (mine.gifs >= LIMITS.MAX_GIFS_PER_USER) {

            await reply(deps, msg, LINES.quota);

            return true;

        }

    }

    const by = user.first_name || user.username || "یه نفر";

    const caption = msg.caption || "";

    const mood = moodFromText(caption);

    const item = {
        kind: "gif",
        fileId: gif.file_id,
        fileUniqueId: gif.file_unique_id,
        mood,
        emoji: null,
        setName: null,
        addedBy: user.id,
        addedByName: by
    };

    await addMediaItems([item]);

    invalidateLibraryCache();

    if (mood !== "misc") {

        await reply(deps, msg, `${pick(LINES.gifSaved)}\nحالش رو گذاشتم: ${MOODS[mood].label}`);

    }
    else {

        await reply(
            deps,
            msg,
            `${pick(LINES.gifSaved)}\nاین گیف به چه حالی می‌خوره؟ یکی رو بزن:`,
            { reply_markup: moodKeyboard(item.fileUniqueId) }
        );

    }

    if (!admin) await notifyAdmin(deps, "gif", { by, item });

    return true;

}

// true یعنی پیام یه مدیای قابل‌یادگیری بود و همین‌جا رسیدگی شد

async function handleIncoming(deps, msg) {

    const admin = isAdmin(deps.adminId, msg.from.id);

    // ممنوع‌شده: ذخیره نمی‌شه
    if (moderation.isBannedMessage(msg)) {

        await reply(deps, msg, LINES.banned);

        return true;

    }

    if (msg.sticker) return handleSticker(deps, msg, admin);

    const gif = gifFrom(msg);

    if (gif) return handleGif(deps, msg, gif, admin);

    const link = (msg.text || msg.caption || "").match(PACK_LINK);

    if (link) return importPack(deps, msg, link[1], admin);

    return false;

}

// ======================================================
// OWNER COMMAND — «کل پک استیکرت رو حذف کن»
//
// فقط مالکِ تأییدشده (checkOwner توی bot.js؛ از روی آیدی/یوزرنیم تلگرام،
// نه از روی متن پیام) می‌تونه کل استیکرهای روبو رو پاک کنه.
// برای بقیه یه جوابِ ثابت برمی‌گرده تا مدل الکی ادعای حذف نکنه.
// گیف‌ها دست نمی‌خورن؛ اگه خواستی اونا هم برن توی deleteAllStickers
// فیلتر { kind: "sticker" } رو بردار.
// ======================================================

const WIPE_LINES = {

    done: "تمام پک استیکر با موفقیت حذف شد ✅",

    empty: "پک استیکرم از قبل خالی بود 😅",

    fail: "نتونستم پک استیکر رو حذف کنم؛ یه مشکلی پیش اومد ❌",

    denied: "این کار فقط دست مالکمه 😎"

};

function prepFa(text) {

    return String(text || "")
        .toLowerCase()
        .replace(/ي/g, "ی")
        .replace(/ك/g, "ک")
        .replace(/[\u064B-\u065F\u0640]/g, "")
        .replace(/\u200c/g, " ")
        .replace(/\s+/g, " ")
        .trim();

}

const NOT_LETTER = "(?![\\p{L}\\d])";

const AFTER_WORD = "(?<![\\p{L}\\d])";

// فعل امر: «حذف کن»، «پاک کن»، «حذفش کن»، «دلیت کن»، «از بین ببر»  («کنم» و «شد» نمی‌خوره)

const WIPE_VERB = new RegExp(
    `${AFTER_WORD}(?:` +
    `(?:حذف|پاکسازی|پاک|دلیت|دیلیت|نابود|ریست)(?:شون|ش|شو)?\\s*(?:کنین|کنید|کنی|کن|بکنی|بکن)${NOT_LETTER}` +
    `|از\\s*بین\\s*ببر${NOT_LETTER}` +
    `|(?:delete|remove|clear|wipe)${NOT_LETTER}` +
    `)`,
    "iu"
);

const WIPE_NOUN = /استیکر|استکیر|sticker/iu;

// «کل / همه / تمام / پک» یعنی کلِ کتابخونه، نه یه استیکرِ تکی

const WIPE_SCOPE = new RegExp(
    `${AFTER_WORD}(?:` +
    `(?:کل|همه|تمامی|تمام|هر\\s?چی|all|whole|entire|every)${NOT_LETTER}` +
    `|پک|پکیج|مجموعه|کلکسیون|pack` +
    `)`,
    "iu"
);

// «حذف نکن»، «نمی‌خوام پاک کنی»  → هیچ‌وقت اجرا نشه

const WIPE_NEGATION = new RegExp(
    `${AFTER_WORD}(?:نکن|نکنی|نکنین|نکنید|نمی\\s?خوام|نباید|مبادا|نه|don'?t|do not|never)${NOT_LETTER}`,
    "iu"
);

// «اگه حذف کنی چی میشه؟» → سوال/شرط، نه دستور

const WIPE_CONDITIONAL = new RegExp(
    `${AFTER_WORD}(?:اگه|اگر|وقتی|چرا|چی\\s?می\\s?شه|چه\\s?می\\s?شه|چه\\s?اتفاقی|if|what if)${NOT_LETTER}`,
    "iu"
);

function isStickerWipeRequest(text) {

    const value = prepFa(text);

    if (!value) return false;

    if (!WIPE_NOUN.test(value)) return false;

    if (!WIPE_VERB.test(value)) return false;

    if (!WIPE_SCOPE.test(value)) return false;

    if (WIPE_NEGATION.test(value)) return false;

    if (WIPE_CONDITIONAL.test(value)) return false;

    return true;

}

// متنِ جوابی که باید فرستاده بشه رو برمی‌گردونه

async function handleStickerWipe(isOwner) {

    if (!isOwner) return WIPE_LINES.denied;

    const count = await deleteAllStickers();

    invalidateLibraryCache();

    if (count === null) return WIPE_LINES.fail;

    if (count === 0) return WIPE_LINES.empty;

    console.log("🗑 STICKER LIBRARY WIPED:", count);

    return WIPE_LINES.done;

}

// ======================================================
// CALLBACKS (دکمه‌ها)
// ======================================================

async function answer(deps, query, text) {

    try {

        await deps.tg("answerCallbackQuery", {
            callback_query_id: query.id,
            text
        });

    }
    catch (error) { /* مهم نیست */ }

}

async function clearButtons(deps, query) {

    if (!query.message) return;

    try {

        await deps.tg("editMessageReplyMarkup", {
            chat_id: query.message.chat.id,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: [] }
        });

    }
    catch (error) { /* مهم نیست */ }

}

async function onCallback(deps, query) {

    const data = String(query.data || "");

    if (!/^(mm|md|mdp)\|/.test(data)) return false;

    const admin = isAdmin(deps.adminId, query.from.id);

    // --- انتخاب حال‌وهوای گیف ---

    if (data.startsWith("mm|")) {

        const [, mood, uniqueId] = data.split("|");

        if (!MOOD_KEYS.includes(mood)) return true;

        const item = await findMediaByUnique(uniqueId);

        if (!item) {

            await answer(deps, query, "این آیتم دیگه نیست");

            return true;

        }

        if (!admin && item.addedBy !== String(query.from.id)) {

            await answer(deps, query, "این مال تو نیست 😄");

            return true;

        }

        await setMediaMood(uniqueId, mood);

        invalidateLibraryCache();

        await answer(deps, query, "ثبت شد ✅");

        if (query.message) {

            try {

                await deps.tg("editMessageText", {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    text: `✅ ثبت شد: ${MOODS[mood].label}`
                });

            }
            catch (error) {

                await clearButtons(deps, query);

            }

        }

        return true;

    }

    // --- حذف توسط ادمین ---

    if (!admin) {

        await answer(deps, query, "فقط ادمین");

        return true;

    }

    const uniqueId = data.split("|")[1];

    if (data.startsWith("md|")) {

        const count = await deleteMediaItem(uniqueId);

        invalidateLibraryCache();

        await answer(deps, query, count ? "حذف شد 🗑" : "پیدا نشد");

        await clearButtons(deps, query);

        return true;

    }

    if (data.startsWith("mdp|")) {

        const item = await findMediaByUnique(uniqueId);

        const count = item && item.setName
            ? await deleteMediaSet(item.setName)
            : await deleteMediaItem(uniqueId);

        invalidateLibraryCache();

        await answer(deps, query, count ? `${count} استیکر حذف شد 🗑` : "پیدا نشد");

        await clearButtons(deps, query);

        return true;

    }

    return true;

}

module.exports = {

    MOODS,

    MOOD_KEYS,

    emojiToMood,

    moodFromText,

    moodReaction,

    describeItem,

    getLibrarySummary,

    invalidateLibraryCache,

    pickForSend,

    sendItem,

    handleIncoming,

    isStickerWipeRequest,

    handleStickerWipe,

    onCallback

};