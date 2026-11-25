#!/usr/bin/env node
/**
 * Keeps shared backend routes (api/, lib/) and shared static assets (public/app.js, sw.js, assets/, vendor/)
 * synchronized from apps/inventory-crm -> apps/billing-counter so both Vercel deployments stay identical.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "apps", "inventory-crm");
const DST = path.join(ROOT, "apps", "billing-counter");

const REL_DIRS = ["api", "lib", path.join("public", "assets"), path.join("public", "vendor")];
const REL_FILES = [path.join("public", "app.js"), path.join("public", "sw.js")];

for (const dir of REL_DIRS) {
    const s = path.join(SRC, dir);
    const d = path.join(DST, dir);
    fs.rmSync(d, { recursive: true, force: true });
    fs.cpSync(s, d, { recursive: true });
}

for (const file of REL_FILES) {
    fs.copyFileSync(path.join(SRC, file), path.join(DST, file));
}

console.log("[OK] Synchronized api/, lib/, app.js, sw.js, assets/, and vendor/ from apps/inventory-crm -> apps/billing-counter.");
