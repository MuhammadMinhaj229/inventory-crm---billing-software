-- ============================================================================
-- MIGRATION V001: CORE GARMENT INVENTORY, 100K CUSTOMERS & BILLING SCHEMA
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(120) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE IF NOT EXISTS bill_no_seq START 1;

CREATE TABLE IF NOT EXISTS store_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    store_name VARCHAR(150) NOT NULL DEFAULT 'Showroom POS & Inventory',
    address_line1 VARCHAR(200) NOT NULL DEFAULT 'Main Commercial Street',
    address_line2 VARCHAR(200) NOT NULL DEFAULT 'City, State - India',
    phone VARCHAR(60) NOT NULL DEFAULT '+91 90000 00000',
    gstin VARCHAR(30) NOT NULL DEFAULT '36AAAAA0000A1Z5',
    bill_prefix VARCHAR(20) NOT NULL DEFAULT 'INV-',
    thermal_width VARCHAR(10) NOT NULL DEFAULT '80mm',
    tax_mode VARCHAR(20) NOT NULL DEFAULT 'exclusive',
    footer_note VARCHAR(300) NOT NULL DEFAULT 'Thank you for your business. Exchange within 7 days with original tag and bill.',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO store_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 1. CUSTOMERS MASTER (Engineered for 100,000+ Customer Profiles & Lifetime History)
CREATE TABLE IF NOT EXISTS customers (
    id BIGSERIAL PRIMARY KEY,
    customer_code VARCHAR(30) UNIQUE NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    alt_phone VARCHAR(20) DEFAULT '',
    email VARCHAR(120) DEFAULT '',
    address TEXT DEFAULT '',
    city VARCHAR(80) DEFAULT '',
    gstin VARCHAR(30) DEFAULT '',
    notes TEXT DEFAULT '',
    total_visits INTEGER NOT NULL DEFAULT 0,
    total_items_bought INTEGER NOT NULL DEFAULT 0,
    total_spent NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
    last_purchase_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. GARMENTS INVENTORY MASTER
CREATE TABLE IF NOT EXISTS garments (
    id BIGSERIAL PRIMARY KEY,
    sku VARCHAR(60) UNIQUE NOT NULL,
    barcode VARCHAR(60) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(80) NOT NULL DEFAULT 'Sherwani',
    sub_category VARCHAR(80) DEFAULT '',
    size VARCHAR(30) NOT NULL DEFAULT '40',
    colour VARCHAR(60) NOT NULL DEFAULT 'Ivory',
    fabric_type VARCHAR(120) DEFAULT '',
    rack_location VARCHAR(50) DEFAULT 'RACK-A1',
    hsn_code VARCHAR(20) NOT NULL DEFAULT '6203',
    cost_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    mrp_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    selling_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    stock_qty INTEGER NOT NULL DEFAULT 0,
    min_stock_alert INTEGER NOT NULL DEFAULT 3,
    total_sold INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. BILLS / TAX INVOICES MASTER (Linked to customers.id)
CREATE TABLE IF NOT EXISTS bills (
    id BIGSERIAL PRIMARY KEY,
    bill_no VARCHAR(40) UNIQUE NOT NULL,
    customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
    customer_code VARCHAR(30) DEFAULT '',
    customer_name VARCHAR(150) NOT NULL DEFAULT 'Walk-in Customer',
    customer_phone VARCHAR(30) DEFAULT '',
    customer_city VARCHAR(120) DEFAULT '',
    customer_gstin VARCHAR(30) DEFAULT '',
    payment_mode VARCHAR(40) NOT NULL DEFAULT 'Cash',
    cash_paid NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    upi_paid NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    card_paid NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_qty INTEGER NOT NULL DEFAULT 0,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    taxable_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    total_gst NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    grand_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    amount_received NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    change_returned NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    tax_mode VARCHAR(20) NOT NULL DEFAULT 'exclusive',
    notes VARCHAR(250) DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. BILL LINE ITEMS (Every Garment Purchased in a Bill)
CREATE TABLE IF NOT EXISTS bill_items (
    id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
    garment_id BIGINT REFERENCES garments(id) ON DELETE SET NULL,
    sku VARCHAR(60) NOT NULL,
    barcode VARCHAR(60) DEFAULT '',
    garment_name VARCHAR(200) NOT NULL,
    category VARCHAR(80) DEFAULT '',
    size VARCHAR(30) DEFAULT '',
    colour VARCHAR(60) DEFAULT '',
    hsn_code VARCHAR(20) DEFAULT '6203',
    qty INTEGER NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    line_discount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    taxable_value NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    gst_rate NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
    cgst_rate NUMERIC(5, 2) NOT NULL DEFAULT 2.50,
    cgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    sgst_rate NUMERIC(5, 2) NOT NULL DEFAULT 2.50,
    sgst_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    line_total NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. STOCK AUDIT LEDGER
CREATE TABLE IF NOT EXISTS stock_ledger (
    id BIGSERIAL PRIMARY KEY,
    garment_id BIGINT NOT NULL REFERENCES garments(id) ON DELETE CASCADE,
    sku VARCHAR(60) NOT NULL,
    change_qty INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    movement_type VARCHAR(40) NOT NULL,
    reference_no VARCHAR(60) DEFAULT '',
    remarks VARCHAR(200) DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
