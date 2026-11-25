const crypto = require("crypto");
const { requireAuth, parseBody } = require("../lib/auth");
const { queryRead, queryBothMerged, runDualWrite } = require("../lib/db");
const { computeLineGST } = require("../lib/gst");
const { dispatchBillNotifications } = require("../lib/notifications");

module.exports = async function handler(req, res) {
    const session = requireAuth(req, res, "any");
    if (!session) return;

    try {
        if (req.method === "GET") {
            const billNo = String(req.query.bill_no || "").trim();
            const id = Number(req.query.id || 0);

            if (billNo) {
                const bills = await queryBothMerged("SELECT * FROM bills WHERE bill_no = $1 LIMIT 1", [billNo], "bill_no");
                const bill = bills[0] || null;
                if (!bill) return res.status(200).json({ ok: true, bill: null, items: [] });
                const items = await queryBothMerged(
                    `SELECT bi.* FROM bill_items bi JOIN bills b ON b.id = bi.bill_id WHERE b.bill_no = $1 ORDER BY bi.id ASC`,
                    [billNo],
                    "id"
                );
                return res.status(200).json({ ok: true, bill, items });
            }

            const [bRes, itemsRes] = await Promise.all([
                queryRead("SELECT * FROM bills WHERE id = $1", [id]),
                queryRead("SELECT * FROM bill_items WHERE bill_id = $1 ORDER BY id ASC", [id]),
            ]);
            return res.status(200).json({ ok: true, bill: bRes.rows[0] || null, items: itemsRes.rows });
        }

        if (req.method === "POST") {
            const data = parseBody(req);
            const cartLines = Array.isArray(data.items) ? data.items : [];
            if (!cartLines.length) {
                return res.status(400).json({ ok: false, error: "Cannot generate an empty bill." });
            }

            const setRes = await queryRead("SELECT * FROM store_settings WHERE id = 1");
            const settings = setRes.rows[0] || {};

            const taxMode = data.tax_mode || settings.tax_mode || "exclusive";
            const customerPhone = String(data.customer_phone || "").trim();
            const customerName = String(data.customer_name || (customerPhone ? `Customer ${customerPhone}` : "Walk-in Customer")).trim();
            const customerCity = String(data.customer_city || "").trim();
            const paymentMode = String(data.payment_mode || "Cash").trim();
            const billDiscount = Math.max(0, Number(data.bill_discount || 0));

            let subtotal = 0, totalLineDisc = 0, taxableSum = 0, cgstSum = 0, sgstSum = 0, grandTotal = 0, totalQty = 0;
            const processedLines = [];
            const customOpts = {
                customGstEnabled: Boolean(data.custom_gst_enabled),
                customCgstRate: data.custom_cgst_rate,
                customSgstRate: data.custom_sgst_rate,
            };

            for (const line of cartLines) {
                const qty = Math.max(1, Number(line.qty || 1));
                const unitPrice = Math.max(0, Number(line.selling_price || 0));
                const lineDisc = Math.max(0, Number(line.line_discount || 0));
                const tax = computeLineGST(unitPrice, qty, lineDisc, taxMode, customOpts);

                subtotal += Number((unitPrice * qty).toFixed(2));
                totalLineDisc += lineDisc;
                taxableSum += tax.taxable_value;
                cgstSum += tax.cgst_amount;
                sgstSum += tax.sgst_amount;
                grandTotal += tax.line_total;
                totalQty += qty;

                processedLines.push({
                    sku: String(line.sku || "").trim(),
                    barcode: String(line.barcode || "").trim(),
                    garment_name: String(line.name || "").trim(),
                    category: String(line.category || "").trim(),
                    size: String(line.size || "").trim(),
                    colour: String(line.colour || "").trim(),
                    hsn_code: String(line.hsn_code || "6203").trim(),
                    qty,
                    unit_price: unitPrice,
                    line_discount: lineDisc,
                    ...tax,
                });
            }

            if (billDiscount > 0 && grandTotal > 0) {
                const ratio = Math.max(0, (grandTotal - billDiscount) / grandTotal);
                taxableSum = Number((taxableSum * ratio).toFixed(2));
                cgstSum = Number((cgstSum * ratio).toFixed(2));
                sgstSum = Number((sgstSum * ratio).toFixed(2));
                grandTotal = Math.max(0, Number((grandTotal - billDiscount).toFixed(2)));
            }

            const totalDiscount = Number((totalLineDisc + billDiscount).toFixed(2));
            const totalGst = Number((cgstSum + sgstSum).toFixed(2));
            const amountReceived = data.amount_received !== "" && data.amount_received !== undefined ? Number(data.amount_received) : grandTotal;
            const changeReturned = Math.max(0, Number((amountReceived - grandTotal).toFixed(2)));
            const cashPaid = Number(data.cash_paid || (paymentMode === "Cash" ? grandTotal : 0));
            const upiPaid = Number(data.upi_paid || (paymentMode === "UPI / QR" ? grandTotal : 0));
            const cardPaid = Number(data.card_paid || (paymentMode === "Card" ? grandTotal : 0));
            const randSuffix = crypto.randomBytes(2).toString("hex").toUpperCase();
            const newCustCode = `CUST-${Date.now().toString(36).toUpperCase()}-${randSuffix}`;

            let out = null;
            let billNo = "";
            for (let attempt = 0; attempt < 3; attempt++) {
                const seqRes = await queryRead(
                    "SELECT GREATEST(nextval('bill_no_seq'), COALESCE((SELECT MAX(id) FROM bills), 0) + 1)::bigint AS seq_no"
                );
                const seqNo = Number(seqRes.rows[0]?.seq_no || Date.now());
                billNo = `${settings.bill_prefix || "INV-"}${String(seqNo).padStart(5, "0")}`;

                try {
                    out = await runDualWrite(async (client) => {
                        let customerId = null;
                        let customerCode = "";

                        if (customerPhone) {
                            const cUp = await client.query(
                                `INSERT INTO customers (customer_code, phone, full_name, city, total_visits, total_items_bought, total_spent, last_purchase_at)
                                 VALUES ($1,$2,$3,$4,1,$5,$6,CURRENT_TIMESTAMP)
                                 ON CONFLICT (phone) DO UPDATE SET
                                   full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), customers.full_name),
                                   city = COALESCE(NULLIF(EXCLUDED.city, ''), customers.city),
                                   total_visits = customers.total_visits + 1,
                                   total_items_bought = customers.total_items_bought + EXCLUDED.total_items_bought,
                                   total_spent = customers.total_spent + EXCLUDED.total_spent,
                                   last_purchase_at = CURRENT_TIMESTAMP,
                                   updated_at = CURRENT_TIMESTAMP
                                 RETURNING id, customer_code`,
                                [newCustCode, customerPhone, customerName, customerCity, totalQty, grandTotal]
                            );
                            customerId = cUp.rows[0].id;
                            customerCode = cUp.rows[0].customer_code;
                        }

                        const billIns = await client.query(
                            `INSERT INTO bills
                             (bill_no, customer_id, customer_code, customer_name, customer_phone, customer_city, payment_mode, tax_mode,
                              total_qty, subtotal, discount_amount, taxable_amount, cgst_amount, sgst_amount, total_gst, grand_total,
                              amount_received, change_returned, cash_paid, upi_paid, card_paid)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
                             RETURNING *`,
                            [
                                billNo, customerId, customerCode, customerName, customerPhone, customerCity, paymentMode, taxMode,
                                totalQty, subtotal, totalDiscount, taxableSum, cgstSum, sgstSum, totalGst, grandTotal,
                                amountReceived, changeReturned, cashPaid, upiPaid, cardPaid,
                            ]
                        );
                        const billRecord = billIns.rows[0];

                        for (const pl of processedLines) {
                            const gUp = await client.query(
                                `UPDATE garments SET stock_qty = GREATEST(0, stock_qty - $1), total_sold = total_sold + $1, updated_at = CURRENT_TIMESTAMP
                                 WHERE sku = $2 RETURNING id, stock_qty`,
                                [pl.qty, pl.sku]
                            );
                            const gId = gUp.rows[0]?.id || null;
                            await client.query(
                                `INSERT INTO bill_items
                                 (bill_id, customer_id, garment_id, sku, barcode, garment_name, category, size, colour, hsn_code,
                                  qty, unit_price, line_discount, taxable_value, gst_rate, cgst_rate, cgst_amount, sgst_rate, sgst_amount, line_total)
                                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
                                [
                                    billRecord.id, customerId, gId, pl.sku, pl.barcode, pl.garment_name, pl.category,
                                    pl.size, pl.colour, pl.hsn_code, pl.qty, pl.unit_price, pl.line_discount, pl.taxable_value,
                                    pl.gst_rate, pl.cgst_rate, pl.cgst_amount, pl.sgst_rate, pl.sgst_amount, pl.line_total,
                                ]
                            );
                            if (gId) {
                                await client.query(
                                    `INSERT INTO stock_ledger (garment_id, sku, change_qty, balance_after, movement_type, reference_no, remarks)
                                     VALUES ($1,$2,$3,$4,'BILL_SALE',$5,$6)`,
                                    [gId, pl.sku, -pl.qty, gUp.rows[0].stock_qty, billNo, `Sold to ${customerName}`]
                                );
                            }
                        }
                        return billRecord;
                    });
                    break;
                } catch (txErr) {
                    if (txErr && txErr.code === "23505" && String(txErr.detail || txErr.constraint || "").includes("bill_no") && attempt < 2) {
                        continue;
                    }
                    throw txErr;
                }
            }

            const notif = await dispatchBillNotifications(out.result, processedLines).catch(() => ({ results: [] }));
            return res.status(200).json({
                ok: true,
                bill: out.result,
                items: processedLines,
                writtenTo: out.writtenTo,
                mirrored: out.mirrored,
                notifications: notif,
            });
        }

        return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    } catch (err) {
        return res.status(500).json({ ok: false, error: err.message });
    }
};
