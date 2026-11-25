# Inventory CRM & Billing Counter — Dual-Product Cloud Suite

> **Powered by [Alif Growth Media](https://alif-growth-media.vercel.app/)**

Production Dual-Product Monorepo designed to deploy **2 independent Vercel web/PWA applications** connected to the **same Dual-PostgreSQL cluster** (Primary DB + Secondary Failover/Mirror & Excess Archive DB) so every SKU update, stock deduction, customer record, and invoice stays 100% live-synced across both apps.

---

## 1. Repository Architecture (2 Separately Deployable Products)

```text
inventory-crm---billing-software/
├── apps/
│   ├── inventory-crm/                <-- VERCEL PROJECT 1 (Root Directory: apps/inventory-crm)
│   │   ├── api/                      Serverless REST endpoints (/api/*)
│   │   ├── lib/                      Dual-DB pool router, HMAC auth, GST & notifications
│   │   ├── public/                   Monochrome B&W Inventory, Matrix, 100K CRM & BI + AGM footer
│   │   ├── package.json
│   │   └── vercel.json
│   │
│   └── billing-counter/              <-- VERCEL PROJECT 2 (Root Directory: apps/billing-counter)
│       ├── api/                      Shared serverless REST endpoints (/api/*)
│       ├── lib/                      Shared Dual-DB pool router, HMAC auth, GST & notifications
│       ├── public/                   D-Mart Counter POS, Thermal Receipt & WhatsApp + AGM footer
│       ├── package.json
│       └── vercel.json
│
├── database/
│   ├── migrations/
│   │   ├── V001__core_schema.sql     Core tables, bill_no_seq sequence & schema_migrations
│   │   ├── V002__performance_indexes_100k.sql   B-Tree + pg_trgm 100k-customer indexes
│   │   └── V003__automations_and_sync.sql       Notifications, printer & cloud sync tables
│   └── migrate.js                    Dual-DB CLI runner (`npm run migrate`)
│
├── scripts/
│   ├── sync-shared-backend.js        Locks api/ + lib/ + shared assets in parity across both apps
│   └── verify-production.js          Pre-deploy verification gate (`npm run verify`)
├── .env.example
└── package.json
```

---

## 2. Step 1 — Set Up Your Dual PostgreSQL Databases

Create two PostgreSQL databases (e.g. **Neon** for Primary + **Supabase** or a second **Neon** project for Secondary):

1. **Primary DB (`PRIMARY_DATABASE_URL`)** — Handles all active reads & writes first.
2. **Secondary DB (`SECONDARY_DATABASE_URL`)** — Receives live mirrors on every transaction, takes over automatically if Primary is unreachable, and stores archived historical bills so Primary stays fast inside free-tier storage limits.

### Run Initial Migrations (Recommended)
```bash
npm install
cp .env.example .env
# Paste your real PRIMARY_DATABASE_URL and SECONDARY_DATABASE_URL in .env
npm run migrate
```
*(Both apps also call `ensureSchema()` automatically on cold start if a database starts completely empty.)*

---

## 3. Step 2 — Deploy Both Apps to Vercel (Same Keys on Both Projects)

Import this GitHub repository **twice** in [Vercel](https://vercel.com/new):

### Vercel Project 1: **Inventory CRM**
- **Project Name:** `agm-inventory-crm` (or your preferred name)
- **Framework Preset:** `Other`
- **Root Directory:** **`apps/inventory-crm`**
- **Build Command:** *(leave empty)*
- **Output Directory:** *(leave empty)*

### Vercel Project 2: **Billing Counter**
- **Project Name:** `agm-billing-counter` (or your preferred name)
- **Framework Preset:** `Other`
- **Root Directory:** **`apps/billing-counter`**
- **Build Command:** *(leave empty)*
- **Output Directory:** *(leave empty)*

---

## 4. Exact Environment Variables (Add Identical Values to BOTH Vercel Projects)

In **Vercel -> Project -> Settings -> Environment Variables**, add these exact 6 keys (scoped to **Production, Preview, and Development**) on **both** `agm-inventory-crm` and `agm-billing-counter`:

| Key | Required | Example Value | Notes |
| :--- | :--- | :--- | :--- |
| **`PRIMARY_DATABASE_URL`** | **Yes** | `postgresql://user:pass@ep-xxxx.aws.neon.tech/neondb?sslmode=require` | **Must be identical on both Vercel apps** |
| **`SECONDARY_DATABASE_URL`** | Recommended | `postgresql://postgres:pass@db.xxxx.supabase.co:5432/postgres?sslmode=require` | Hot standby mirror, automatic failover & excess archive DB |
| **`PRIMARY_MAX_MB`** | Recommended | `420` | Primary capacity threshold in MB before UI flags archive recommendation |
| **`OWNER_PIN`** | **Yes** | `482910` | Owner PIN (full access to Inventory, Settings, Dual-DB Admin & Billing) |
| **`STAFF_PIN`** | Optional | `1234` | Counter cashier PIN (Billing & lookups only; hides Settings & Dual-DB Admin) |
| **`SESSION_SECRET`** | **Yes** | `<64-char random hex string>` | Secret for signing HttpOnly auth cookies (generate via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |

> **Critical:** Because both Vercel projects share the exact same `PRIMARY_DATABASE_URL` and `SECONDARY_DATABASE_URL`, every bill punched in **Billing Counter** immediately deducts garment stock and updates Customer 360° history in **Inventory CRM**—and every SKU added/updated in **Inventory CRM** is immediately live at the counter.

---

## 5. Step 3 — Verify Both Deployments

After deploying both projects, visit `/api/health` on each live domain:

- **`https://<inventory-crm-domain>.vercel.app/api/health`**
  - Verify `"ok": true`, `"product": "agm-inventory-crm"`, `"powered_by": "Alif Growth Media"`, all `"env_configured"` flags `true`, and both `primary.online` & `secondary.online` `true`.
- **`https://<billing-counter-domain>.vercel.app/api/health`**
  - Verify `"ok": true`, `"product": "agm-billing-counter"`, and the exact same DB counts/health.

### Install Both as Standalone Desktop Apps (PWA)
Open each URL in Chrome/Edge and click **Install App** in the address bar (`Billing Counter` for counter terminals and `Showroom Inventory & CRM` for back-office/owner devices).
