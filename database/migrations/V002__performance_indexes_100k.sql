-- ============================================================================
-- MIGRATION V002: HIGH-SPEED B-TREE & TRIGRAM INDEXES FOR 100,000+ CUSTOMERS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Customers Indexes (Instant lookup across 100,000+ profiles by Phone, Name, Code, Spend, or Last Visit)
CREATE INDEX IF NOT EXISTS idx_customers_phone_prefix ON customers (phone varchar_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING GIN (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_city_lower ON customers (LOWER(city));
CREATE INDEX IF NOT EXISTS idx_customers_total_spent_desc ON customers (total_spent DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_customers_last_purchase_desc ON customers (last_purchase_at DESC NULLS LAST, id DESC);

-- Garments Indexes (Instant barcode scanning, SKU lookup, category filtering, and low-stock queries)
CREATE INDEX IF NOT EXISTS idx_garments_active_category ON garments (active, category, name);
CREATE INDEX IF NOT EXISTS idx_garments_name_trgm ON garments USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_garments_low_stock ON garments (active, stock_qty, min_stock_alert);

-- Bills & Bill Items Indexes (Instant customer purchase history retrieval)
CREATE INDEX IF NOT EXISTS idx_bills_customer_history ON bills (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bills_customer_phone ON bills (customer_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bills_created_at_desc ON bills (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_items_bill_id ON bill_items (bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_items_customer_id ON bill_items (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_items_garment_id ON bill_items (garment_id);

-- Stock Ledger Index
CREATE INDEX IF NOT EXISTS idx_stock_ledger_garment_date ON stock_ledger (garment_id, created_at DESC);
