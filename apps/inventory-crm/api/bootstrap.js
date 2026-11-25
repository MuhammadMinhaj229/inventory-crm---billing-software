const { requireAuth } = require("../lib/auth");
const { queryRead, getDualDbStatus } = require("../lib/db");

module.exports = async function handler(req, res) {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    const session = requireAuth(req, res, "any");
    if (!session) return;

    try {
        const [
            settingsRes,
            autoRes,
            garmentsRes,
            kpiSalesRes,
            kpiStockRes,
            kpiCustRes,
            catRes,
            billsRes,
            ledgerRes,
            notifRes,
            nextIdRes,
            dualDb,
        ] = await Promise.all([
            queryRead("SELECT * FROM store_settings WHERE id = 1"),
            queryRead("SELECT * FROM automation_settings WHERE id = 1"),
            queryRead("SELECT * FROM garments WHERE active = TRUE ORDER BY id ASC"),
            queryRead(`
                SELECT
                    COALESCE(SUM(CASE WHEN DATE(created_at) = CURRENT_DATE THEN grand_total ELSE 0 END), 0)::numeric(14,2) AS today_revenue,
                    COALESCE(COUNT(CASE WHEN DATE(created_at) = CURRENT_DATE THEN 1 END), 0)::int AS today_bills,
                    COALESCE(SUM(grand_total), 0)::numeric(14,2) AS total_revenue,
                    COALESCE(COUNT(*), 0)::int AS total_bills,
                    COALESCE(SUM(total_gst), 0)::numeric(14,2) AS total_gst_collected,
                    COALESCE(SUM(cgst_amount), 0)::numeric(14,2) AS total_cgst,
                    COALESCE(SUM(sgst_amount), 0)::numeric(14,2) AS total_sgst
                FROM bills
            `),
            queryRead(`
                SELECT
                    COUNT(*)::int AS active_skus,
                    COALESCE(SUM(stock_qty), 0)::int AS total_units,
                    COALESCE(SUM(stock_qty * cost_price), 0)::numeric(14,2) AS cost_valuation,
                    COALESCE(SUM(stock_qty * selling_price), 0)::numeric(14,2) AS retail_valuation,
                    COALESCE(COUNT(CASE WHEN stock_qty <= min_stock_alert THEN 1 END), 0)::int AS low_stock_count
                FROM garments
                WHERE active = TRUE
            `),
            queryRead("SELECT COUNT(*)::int AS total_customers FROM customers"),
            queryRead(`
                SELECT
                    category,
                    COUNT(*)::int AS sku_count,
                    COALESCE(SUM(stock_qty), 0)::int AS total_units,
                    COALESCE(SUM(stock_qty * selling_price), 0)::numeric(14,2) AS stock_value
                FROM garments
                WHERE active = TRUE
                GROUP BY category
                ORDER BY stock_value DESC
            `),
            queryRead("SELECT * FROM bills ORDER BY id DESC LIMIT 50"),
            queryRead(`
                SELECT sl.*, g.name AS garment_name, g.size, g.colour
                FROM stock_ledger sl
                JOIN garments g ON g.id = sl.garment_id
                ORDER BY sl.id DESC LIMIT 40
            `),
            queryRead("SELECT * FROM notification_logs ORDER BY id DESC LIMIT 40"),
            queryRead("SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM bills"),
            getDualDbStatus(),
        ]);

        const settings = settingsRes.rows[0] || {};
        const nextId = nextIdRes.rows[0]?.next_id || 1;
        const nextBillNo = `${settings.bill_prefix || "INV-"}${String(nextId).padStart(5, "0")}`;

        // Hide secret API tokens from staff role
        const automations = autoRes.rows[0] || {};
        if (session.role !== "owner") {
            automations.whatsapp_api_token = "";
            automations.sms_api_key = "";
        }

        return res.status(200).json({
            ok: true,
            role: session.role,
            db_source: settingsRes._source || "primary",
            dual_db: dualDb,
            settings,
            automations,
            garments: garmentsRes.rows,
            kpis: {
                ...kpiSalesRes.rows[0],
                ...kpiStockRes.rows[0],
                total_customers: kpiCustRes.rows[0]?.total_customers || 0,
            },
            categories: catRes.rows,
            recent_bills: billsRes.rows,
            stock_ledger: ledgerRes.rows,
            notification_logs: notifRes.rows,
            next_bill_no: nextBillNo,
        });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};
