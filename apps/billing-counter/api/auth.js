const {
    safeEqual,
    getSession,
    setSessionCookie,
    clearSessionCookie,
    checkRateLimit,
    recordFailedLogin,
    clearLoginAttempts,
    parseBody,
} = require("../lib/auth");

module.exports = async function handler(req, res) {
    const action = req.query.action || (req.method === "GET" ? "status" : "login");

    if (req.method === "GET" && action === "status") {
        const session = getSession(req);
        return res.status(200).json({
            ok: true,
            authenticated: Boolean(session),
            role: session ? session.role : null,
            pinConfigured: Boolean(process.env.OWNER_PIN),
        });
    }

    if (req.method === "POST" && action === "logout") {
        clearSessionCookie(res);
        return res.status(200).json({ ok: true });
    }

    if (req.method === "POST" && action === "login") {
        const rl = checkRateLimit(req);
        if (rl.blocked) {
            return res.status(429).json({
                ok: false,
                error: `Too many failed attempts. Please wait ${rl.retrySec} seconds.`,
            });
        }

        const body = parseBody(req);
        const pin = String(body.pin || "").trim();
        const ownerPin = String(process.env.OWNER_PIN || "").trim();
        const staffPin = String(process.env.STAFF_PIN || "").trim();

        if (!ownerPin) {
            setSessionCookie(res, "owner");
            return res.status(200).json({ ok: true, role: "owner", setupMode: true });
        }

        if (pin && safeEqual(pin, ownerPin)) {
            clearLoginAttempts(rl.ip);
            setSessionCookie(res, "owner");
            return res.status(200).json({ ok: true, role: "owner" });
        }

        if (staffPin && pin && safeEqual(pin, staffPin)) {
            clearLoginAttempts(rl.ip);
            setSessionCookie(res, "staff");
            return res.status(200).json({ ok: true, role: "staff" });
        }

        recordFailedLogin(rl.ip, rl.rec);
        return res.status(401).json({ ok: false, error: "Incorrect PIN. Please try again." });
    }

    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
};
