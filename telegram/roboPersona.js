// ======================================================
// ROBO PERSONA — نسخه‌ی v10 (ماژولار)
//
// پرامپتِ روبو حالا توی فایل‌های جدا زندگی می‌کنه (پوشه‌ی persona/) و این فایل
// فقط اون‌ها رو به‌هم می‌چسبونه:
//
//   core         هویت و قانون‌های اصلی
//   integrity    حرفِ حساب: بدون چاپلوسی، بدون پذیرفتنِ بی‌دلیل، بدون چرت‌وپرت، کوتاه
//   rules        خط قرمزها، موقعیت‌های حساس، صداقت درباره‌ی خود، امنیت
//   personality  شخصیت، عواطف، سرد شدن
//   thermostat   سطح‌های تیکه، جواب به بی‌احترامی، دیس و دیس‌بک
//   tone         لحن و ظاهر پیام
//   lexicon      کتابخونه‌ی کلمات و اصطلاحات (قابل ویرایش)
//   quality      کیفیت جواب (+ قواعد سرچ و سایت، فقط وقتی داده شده)
//   engagement   کِی وارد بحث شو، ابتکار، حال‌وهوا (فقط بخش‌های لازم)
//   people       آدم‌ها و ریپلای
//   media        ریکشن (همیشه) + استیکر و گیف (فقط وقتی کتابخونه هست)
//   voice        ویس (فقط وقتی ویس فعاله)
//   owner        مالک و relay (فقط وقتی مالک توی پیوی‌ه)
//   output       فرمت JSON و چک‌لیست آخر
//   examples/    مثال‌ها (فقط مثال‌های مربوط به موقعیت)
//
// خروجی دو شکل داره:
//   SYSTEM_PROMPT            پرامپتِ کامل (مثل قبل؛ هر بخش و هر مثال)
//   buildSystemPrompt(ctx)   فقط بخش‌های لازمِ همین نوبت؛ کوچک‌تر و سریع‌تر
//
// فرمت خروجی (JSON) و تگ‌ها (<people>، <task>، <situation> و ...) عوض نشده؛
// پس بقیه‌ی کدت بدون تغییر کار می‌کنه.
// ======================================================

const core = require("./persona/core");
const integrity = require("./persona/integrity");
const rules = require("./persona/rules");
const personality = require("./persona/personality");
const thermostat = require("./persona/thermostat");
const tone = require("./persona/tone");
const lexicon = require("./persona/lexicon");
const quality = require("./persona/quality");
const engagement = require("./persona/engagement");
const people = require("./persona/people");
const media = require("./persona/media");
const voice = require("./persona/voice");
const owner = require("./persona/owner");
const output = require("./persona/output");
const examples = require("./persona/examples");

// ======================================================
// flagها: از روی ctx نوبتِ فعلی معلوم می‌شه کدوم بخش‌ها لازمن
// ======================================================

function flagsOf(ctx) {

    const c = ctx || {};

    const full = Boolean(c._full);

    const isPrivate = c.chatType === "private";

    const trigger = c.trigger || "none";

    const event = c.event || null;

    return {
        full,
        isPrivate,
        group: full || !isPrivate,
        trigger,
        event,
        // گروه، صدات نزدن، رویداد خاصی هم نیست
        watching: full || (trigger === "none" && !event && !isPrivate),
        spark: full || event === "spark",
        join: full || event === "join",
        followup: full || trigger === "followup",
        mood: full || Boolean(c.mood),
        moodKey: (c.mood && c.mood.key) || null,
        owner: full || Boolean(c.ownerPrivate),
        voice: full || Boolean(c.voiceMode),
        media: full || Boolean(c.library),
        code: full || Boolean(c.codeAsk),
        web: full || Boolean(c.web),
        site: full || Boolean(c.siteContext)
    };

}

// ترتیب مهمه: قانون‌های مهم اول، فرمت و چک‌لیست آخر (جایی که مدل بیشتر دقت می‌کنه)
const ORDER = [
    core,
    integrity,
    rules,
    personality,
    thermostat,
    tone,
    lexicon,
    quality,
    engagement,
    people,
    media,
    voice,
    owner,
    output,
    examples
];

// voice و owner فقط وقتی فعال باشن بخش خودشون رو می‌دن
const ONLY_WHEN = new Map([
    [voice, f => f.voice],
    [owner, f => f.owner]
]);

const cache = new Map();

function assemble(f) {

    const parts = [];

    for (const mod of ORDER) {

        const gate = ONLY_WHEN.get(mod);

        if (gate && !gate(f)) continue;

        const text = mod.build(f);

        if (text) parts.push(text);

    }

    parts.push(output.final());

    return parts.join("\n\n");

}

function buildSystemPrompt(ctx) {

    const flags = flagsOf(ctx);

    const key = JSON.stringify(flags);

    let prompt = cache.get(key);

    if (!prompt) {

        prompt = assemble(flags);

        cache.set(key, prompt);

    }

    return prompt;

}

// پرامپتِ کامل؛ سازگار با نسخه‌های قبل (require("./roboPersona").SYSTEM_PROMPT)
const SYSTEM_PROMPT = buildSystemPrompt({ _full: true });

module.exports = {

    SYSTEM_PROMPT,

    buildSystemPrompt,

    // برای تست
    flagsOf

};