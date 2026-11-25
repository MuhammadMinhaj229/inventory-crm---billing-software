function computeLineGST(unitPrice, qty, lineDiscount, taxMode, customOpts = {}) {
    const gross = Math.max(0, Number(unitPrice) * Number(qty) - Number(lineDiscount || 0));
    const effectiveUnit = qty > 0 ? gross / qty : Number(unitPrice);
    let gstRate, cgstRate, sgstRate, taxableValue, cgstAmount, sgstAmount, lineTotal;

    if (customOpts.customGstEnabled) {
        cgstRate = Math.max(0, Number(customOpts.customCgstRate ?? 2.5));
        sgstRate = Math.max(0, Number(customOpts.customSgstRate ?? 2.5));
        gstRate = Number((cgstRate + sgstRate).toFixed(2));
    } else {
        if (taxMode === "inclusive") {
            gstRate = effectiveUnit <= 2625.0 ? 5.0 : 12.0;
        } else {
            gstRate = effectiveUnit <= 2500.0 ? 5.0 : 12.0;
        }
        cgstRate = gstRate / 2;
        sgstRate = gstRate / 2;
    }

    if (taxMode === "inclusive") {
        taxableValue = Number((gross / (1 + gstRate / 100)).toFixed(2));
        cgstAmount = Number((taxableValue * (cgstRate / 100)).toFixed(2));
        sgstAmount = Number((gross - taxableValue - cgstAmount).toFixed(2));
        lineTotal = Number(gross.toFixed(2));
    } else {
        taxableValue = Number(gross.toFixed(2));
        cgstAmount = Number((taxableValue * (cgstRate / 100)).toFixed(2));
        sgstAmount = Number((taxableValue * (sgstRate / 100)).toFixed(2));
        lineTotal = Number((taxableValue + cgstAmount + sgstAmount).toFixed(2));
    }

    return {
        taxable_value: taxableValue,
        gst_rate: gstRate,
        cgst_rate: cgstRate,
        cgst_amount: cgstAmount,
        sgst_rate: sgstRate,
        sgst_amount: sgstAmount,
        line_total: lineTotal,
    };
}

module.exports = { computeLineGST };
