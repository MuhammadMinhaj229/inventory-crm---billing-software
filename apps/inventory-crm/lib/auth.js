const crypto = require("crypto");

const COOKIE_NAME = "pos_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days (ideal for showroom TV counter)

// Lightweight per-instance brute-force protection
const loginAttempts = new Map();

function getSessionSecret() {
    return process.env.SESSION_SECRET || process.env.OWNER_PIN || "dev-fallback-change-in-vercel";
}

function safeEqual(a, b) {
    const ba = Buffer.from(String(a || ""), "utf8");
    const bb = Buffer.from(String(b || ""), "utf8");
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
}

function signPayload(payloadObj) {
    const data = Buffer.from(JSON.stringify(payloadObj), "utf8").toString("base64url");
    const sig = crypto
        .createHmac("sha256", getSessionSecret())
        .update(data)
        .digest("base64url");
    return `${data}.${sig}`;
}

function verifyToken(token) {
    if (!token || !token.includes(".")) return null;
    const [data, sig] = token.split(".");
    const expected = crypto
        .createHmac("sha256", getSessionSecret())
        .update(data)
        .digest("base64url");
    if (!safeEqual(sig, expected)) return null;
    try {
        const parsed = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
        if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

function parseCookies(req) {
    const header = req.headers.cookie || "";
    const out = {};
    header.split(";").forEach((part) => {
        const idx = part.indexOf("=");
        if (idx > 0) {
            out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
        }
    });
    return out;
}

function getSession(req) {
    // If OWNER_PIN is not configured at all, allow setup mode with owner role
    if (!process.env.OWNER_PIN) {
        return { role: "owner", setupMode: true };
    }
    const cookies = parseCookies(req);
    const token = cookies[COOKIE_NAME];
    return verifyToken(token);
}

function setSessionCookie(res, role) {
    const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
    const token = signPayload({ role, exp });
    const isProd = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
    const parts = [
        `${COOKIE_NAME}=${encodeURIComponent(token)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        `Max-Age=${SESSION_TTL_SEC}`,
    ];
    if (isProd) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res) {
    res.setHeader(
        "Set-Cookie",
        `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    );
}

function checkRateLimit(req) {
    const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
    const now = Date.now();
    const rec = loginAttempts.get(ip) || { count: 0, resetAt: now + 15 * 60 * 1000 };
    if (now > rec.resetAt) {
        rec.count = 0;
        rec.resetAt = now + 15 * 60 * 1000;
    }
    if (rec.count >= 12) {
        return { blocked: true, retrySec: Math.ceil((rec.resetAt - now) / 1000) };
    }
    return { blocked: false, ip, rec };
}

function recordFailedLogin(ip, rec) {
    rec.count += 1;
    loginAttempts.set(ip, rec);
}

function clearLoginAttempts(ip) {
    loginAttempts.delete(ip);
}

function requireAuth(req, res, requiredRole = "any") {
    const session = getSession(req);
    if (!session) {
        res.status(401).json({ ok: false, error: "Authentication required", authRequired: true });
        return null;
    }
    if (requiredRole === "owner" && session.role !== "owner") {
        res.status(403).json({ ok: false, error: "Owner permission required" });
        return null;
    }
    return session;
}

function parseBody(req) {
    if (!req.body) return {};
    if (typeof req.body === "string") {
        try { return JSON.parse(req.body); } catch (_) { return {}; }
    }
    return req.body;
}

module.exports = {
    safeEqual,
    getSession,
    setSessionCookie,
    clearSessionCookie,
    checkRateLimit,
    recordFailedLogin,
    clearLoginAttempts,
    requireAuth,
    parseBody,
};
