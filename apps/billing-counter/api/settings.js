const { requireAuth, parseBody } = require("../lib/auth");
const {
    queryRead,
    queryBothMerged,
    runDualWrite,
    getDualDbStatus,
    syncPrimaryToSecondary,
    archiveExcessToSecondary,
} = require("../lib/db");
const { dispatchBillNotifications } = require("../lib/notifications");

module.exports = async function handler(req, res) {
    // CSV export via GET
    if (req.method === "GET" && req.query.action === "exportCsv") {
        const session = requireAuth(req, res, "any");
        if (!session) return;
        const type = req.query.type || "bills";
        try {
            let rows = [], headers = [], fileName = "Export.csv";
            if (type === "customers") {
                fileName = "Customers_Purchase_History.csv";
                headers = ["Customer Code", "Full Name", "Mobile", "City", "Address", "Visits", "Items Bought", "Lifetime Spend (INR)", "Last Purchase"];
                const r = await queryRead("SELECT * FROM customers ORDER BY total_spent DESC, id DESC");
                rows = r.rows.map((c) => [c.customer_code, c.full_name, c.phone, c.city, c.address, c.total_visits, c.total_items_bought, c.total_spent, c.last_purchase_at || ""]);
            } else if (type === "garments") {
                fileName = "Garment_Inventory_Stock.csv";
                headers = ["SKU", "Barcode", "Garment Name", "Category", "Size", "Colour", "Rack", "HSN", "Cost", "Selling", "Stock Qty", "Total Sold"];
                const r = await queryRead("SELECT * FROM garments WHERE active = TRUE ORDER BY category, sku");
                rows = r.rows.map((g) => [g.sku, g.barcode, g.name, g.category, g.size, g.colour, g.rack_location, g.hsn_code, g.cost_price, g.selling_price, g.stock_qty, g.total_sold]);
            } else {
                fileName = "GST_Bills_Report.csv";
                headers = ["Bill No", "Date", "Customer Code", "Customer Name", "Mobile", "Payment Mode", "Qty", "Subtotal", "Discount", "Taxable", "CGST", "SGST", "Total GST", "Grand Total"];
                const merged = await queryBothMerged("SELECT * FROM bills ORDER BY created_at DESC", [], "bill_no");
                rows = merged.map((b) => [b.bill_no, b.created_at, b.customer_code, b.customer_name, b.customer_phone, b.payment_mode, b.total_qty, b.subtotal, b.discount_amount, b.taxable_amount, b.cgst_amount, b.sgst_amount, b.total_gst, b.grand_total]);
            }
            const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
            const csv = "\ufeff" + [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
            return res.status(200).send(csv);
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    const body = parseBody(req);
    const action = body.action || "saveStore";

    // Resend bill notification allowed for any authenticated user
    if (action === "resendNotification") {
        const session = requireAuth(req, res, "any");
        if (!session) return;
        try {
            const billNo = String(body.bill_no || "").trim();
            const bills = await queryBothMerged("SELECT * FROM bills WHERE bill_no = $1 LIMIT 1", [billNo], "bill_no");
            if (!bills[0]) return res.status(404).json({ ok: false, error: "Bill not found" });
            const items = await queryBothMerged(
                `SELECT bi.* FROM bill_items bi JOIN bills b ON b.id = bi.bill_id WHERE b.bill_no = $1 ORDER BY bi.id ASC`,
                [billNo],
                "id"
            );
            const result = await dispatchBillNotifications(bills[0], items);
            return res.status(200).json(result);
        } catch (err) {
            return res.status(500).json({ ok: false, error: err.message });
        }
    }

    // All other settings & Dual-DB admin operations require OWNER role
    const session = requireAuth(req, res, "owner");
    if (!session) return;

    try {
        if (action === "saveStore") {
            await runDualWrite(async (client) => {
                await client.query(
                    `UPDATE store_settings
                     SET store_name=$1, address_line1=$2, address_line2=$3, phone=$4, gstin=$5,
                         bill_prefix=$6, thermal_width=$7, tax_mode=$8, footer_note=$9, updated_at=CURRENT_TIMESTAMP
                     WHERE id = 1`,
                    [
                        body.store_name || "Showroom POS & Inventory",
                        body.address_line1 || "",
                        body.address_line2 || "",
                        body.phone || "",
                        body.gstin || "",
                        body.bill_prefix || "INV-",
                        body.thermal_width || "80mm",
                        body.tax_mode || "exclusive",
                        body.footer_note || "",
                    ]
                );
            });
            return res.status(200).json({ ok: true });
        }

        if (action === "saveAutomations") {
            await runDualWrite(async (client) => {
                await client.query(
                    `UPDATE automation_settings
                     SET printer_mode=$1, whatsapp_enabled=$2, whatsapp_mode=$3, whatsapp_api_url=$4,
                         whatsapp_api_token=$5, whatsapp_phone_number_id=$6, whatsapp_template=$7,
                         sms_enabled=$8, sms_provider=$9, sms_api_key=$10, sms_sender_id=$11, sms_template=$12,
                         updated_at=CURRENT_TIMESTAMP
                     WHERE id = 1`,
                    [
                        body.printer_mode || "browser",
                        Boolean(body.whatsapp_enabled),
                        body.whatsapp_mode || "wa_link",
                        body.whatsapp_api_url || "",
                        body.whatsapp_api_token || "",
                        body.whatsapp_phone_number_id || "",
                        body.whatsapp_template || "",
                        Boolean(body.sms_enabled),
                        body.sms_provider || "fast2sms",
                        body.sms_api_key || "",
                        body.sms_sender_id || "",
                        body.sms_template || "",
                    ]
                );
            });
            return res.status(200).json({ ok: true });
        }

        if (action === "dbStatus") {
            const status = await getDualDbStatus();
            return res.status(200).json({ ok: true, dual_db: status });
        }

        if (action === "syncSecondary") {
            const result = await syncPrimaryToSecondary();
            return res.status(200).json(result);
        }

        if (action === "archiveExcess") {
            const result = await archiveExcessToSecondary(Number(body.days || 90));
            return res.status(200).json(result);
        }

        return res.status(400).json({ ok: false, error: "Unknown settings action" });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};
