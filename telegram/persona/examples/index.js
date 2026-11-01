// ======================================================
// EXAMPLES — انتخابِ مثال‌ها بر اساس موقعیت
//
// مثال‌های core همیشه میان؛ مثال‌های situational فقط وقتی شرطشون (needs) برقراره.
// توی پرامپتِ کامل (f.full) همه‌شون میان.
// ======================================================

const { serialize } = require("./make");

const CORE = require("./core");

const SITUATIONAL = require("./situational");

const HEADER = `
━━━━━━━━━━━━━━━━━━━━
مثال‌ها
━━━━━━━━━━━━━━━━━━━━
(توضیحِ داخل پرانتز موقعیته و بخشی از خروجی نیست. مثال‌ها فقط حال‌وهوا و کوتاهی رو نشون می‌دن؛ کپی‌شون نکن و هر بار از دلِ لحظه، جواب تازه بساز.)
`.trim();

function select(f) {

    const picked = CORE.slice();

    for (const item of SITUATIONAL) {

        if (f.full || !item.needs || item.needs(f)) picked.push(item);

    }

    return picked;

}

function build(f) {

    const blocks = select(f).map(item => `(${item.note})\n${serialize(item.out)}`);

    return HEADER + "\n\n" + blocks.join("\n\n");

}

module.exports = { build, select };