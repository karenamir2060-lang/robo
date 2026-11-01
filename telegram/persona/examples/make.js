// ======================================================
// EXAMPLES / MAKE — ساختنِ مثال‌ها
//
// هر مثال: ex("توضیحِ موقعیت", { ...خروجی }, needs?)
//   needs = تابعی که از روی flagهای ctx می‌گه این مثال الان لازمه یا نه
//           (نداشته باشه = همیشه میاد)
//
// خروجی با JSON.stringify ساخته می‌شه؛ پس escape کردنِ نقل‌قول و خط جدید
// (حتی داخل بلاک کد) خودکار و همیشه درسته.
// ======================================================

function ex(note, out, needs) {

    return { note, out, needs: needs || null };

}

function serialize(out) {

    const o = out || {};

    const ordered = {
        action: o.action || "ignore",
        reaction: o.reaction === undefined ? null : o.reaction,
        reply_to: o.reply_to === undefined ? null : o.reply_to,
        text: o.text || "",
        media: o.media === undefined ? null : o.media
    };

    if (o.voice !== undefined) ordered.voice = o.voice;

    ordered.relay = o.relay === undefined ? null : o.relay;

    ordered.why = o.why || "";

    return JSON.stringify(ordered);

}

module.exports = { ex, serialize };