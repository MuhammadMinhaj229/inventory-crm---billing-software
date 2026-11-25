const { queryRead, runDualWrite } = require("./db");

function formatTemplate(template, vars) {
    return String(template || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ""));
}

function normalizeIndianPhone(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.length === 10) return "91" + digits;
    return digits;
}

async function dispatchBillNotifications(bill, items) {
    const [autoRes, storeRes] = await Promise.all([
        queryRead("SELECT * FROM automation_settings WHERE id = 1"),
        queryRead("SELECT * FROM store_settings WHERE id = 1"),
    ]);
    const auto = autoRes.rows[0];
    const store = storeRes.rows[0] || {};
    if (!auto) return { ok: true, results: [] };

    const phone = normalizeIndianPhone(bill.customer_phone);
    if (!phone) return { ok: true, results: [], skipped: "No customer phone number" };

    const itemsSummary = (items || [])
        .map((it) => `${it.garment_name} (${it.size}) x${it.qty}`)
        .join(", ");

    const vars = {
        customer_name: bill.customer_name || "Valued Customer",
        store_name: store.store_name || "Showroom",
        bill_no: bill.bill_no,
        grand_total: Number(bill.grand_total || 0).toFixed(2),
        items_summary: itemsSummary || `${bill.total_qty} item(s)`,
        payment_mode: bill.payment_mode || "Cash",
    };

    const results = [];
    let waLinkUrl = "";

    // 1. WHATSAPP AUTOMATION
    if (auto.whatsapp_enabled) {
        const waText = formatTemplate(auto.whatsapp_template, vars);
        let status = "FAILED";
        let respText = "";
        try {
            if (auto.whatsapp_mode === "wa_link") {
                waLinkUrl = `https://wa.me/${phone}?text=${encodeURIComponent(waText)}`;
                status = "READY_WA_LINK";
                respText = "Generated wa.me link for device WhatsApp";
            } else if (auto.whatsapp_mode === "cloud_api" && auto.whatsapp_api_token && auto.whatsapp_phone_number_id) {
                const url = `https://graph.facebook.com/v20.0/${auto.whatsapp_phone_number_id}/messages`;
                const r = await fetch(url, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${auto.whatsapp_api_token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        messaging_product: "whatsapp",
                        to: phone,
                        type: "text",
                        text: { body: waText },
                    }),
                });
                respText = await r.text();
                status = r.ok ? "SENT" : "FAILED";
            } else if (auto.whatsapp_mode === "webhook" && auto.whatsapp_api_url) {
                const r = await fetch(auto.whatsapp_api_url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(auto.whatsapp_api_token ? { Authorization: `Bearer ${auto.whatsapp_api_token}` } : {}),
                    },
                    body: JSON.stringify({ phone, message: waText, bill_no: bill.bill_no, grand_total: bill.grand_total, items }),
                });
                respText = await r.text();
                status = r.ok ? "SENT" : "FAILED";
            } else {
                respText = "WhatsApp API credentials missing in Settings";
            }
        } catch (err) {
            respText = err.message;
        }

        await runDualWrite(
            async (client) => {
                await client.query(
                    `INSERT INTO notification_logs (bill_id, bill_no, customer_name, customer_phone, channel, status, message_text, provider_response)
                     VALUES ($1,$2,$3,$4,'WHATSAPP',$5,$6,$7)`,
                    [bill.id || null, bill.bill_no, bill.customer_name, bill.customer_phone, status, waText, respText.slice(0, 500)]
                );
            },
            { mirrorToSecondary: false }
        ).catch(() => {});

        results.push({ channel: "WHATSAPP", status, waLinkUrl });
    }

    // 2. MOBILE SMS AUTOMATION (Fast2SMS / MSG91)
    if (auto.sms_enabled) {
        const smsText = formatTemplate(auto.sms_template, vars);
        const phone10 = phone.slice(-10);
        let status = "FAILED";
        let respText = "";
        try {
            if (!auto.sms_api_key) {
                respText = "SMS API key missing in Settings";
            } else if (auto.sms_provider === "fast2sms") {
                const r = await fetch("https://www.fast2sms.com/dev/bulkV2", {
                    method: "POST",
                    headers: {
                        authorization: auto.sms_api_key,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        route: "q",
                        message: smsText,
                        numbers: phone10,
                    }),
                });
                respText = await r.text();
                status = r.ok ? "SENT" : "FAILED";
            } else if (auto.sms_provider === "msg91") {
                const r = await fetch("https://control.msg91.com/api/v2/sendsms", {
                    method: "POST",
                    headers: {
                        authkey: auto.sms_api_key,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        sender: auto.sms_sender_id || "TXTSMS",
                        route: "4",
                        country: "91",
                        sms: [{ message: smsText, to: [phone10] }],
                    }),
                });
                respText = await r.text();
                status = r.ok ? "SENT" : "FAILED";
            }
        } catch (err) {
            respText = err.message;
        }

        await runDualWrite(
            async (client) => {
                await client.query(
                    `INSERT INTO notification_logs (bill_id, bill_no, customer_name, customer_phone, channel, status, message_text, provider_response)
                     VALUES ($1,$2,$3,$4,'SMS',$5,$6,$7)`,
                    [bill.id || null, bill.bill_no, bill.customer_name, bill.customer_phone, status, smsText, respText.slice(0, 500)]
                );
            },
            { mirrorToSecondary: false }
        ).catch(() => {});

        results.push({ channel: "SMS", status });
    }

    return { ok: true, results, waLinkUrl };
}

module.exports = { dispatchBillNotifications };
