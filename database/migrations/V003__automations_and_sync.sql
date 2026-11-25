-- ============================================================================
-- MIGRATION V003: PRINTER HARDWARE, WHATSAPP/SMS AUTOMATION & VERCEL CLOUD SYNC
-- ============================================================================

CREATE TABLE IF NOT EXISTS automation_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    -- Thermal Printer Hardware & Web/Cloud Print Mode
    printer_mode VARCHAR(30) NOT NULL DEFAULT 'browser',
    printer_device_name VARCHAR(200) NOT NULL DEFAULT '',
    silent_print BOOLEAN NOT NULL DEFAULT FALSE,
    -- WhatsApp Automation
    whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    whatsapp_mode VARCHAR(30) NOT NULL DEFAULT 'wa_link',
    whatsapp_api_url TEXT NOT NULL DEFAULT '',
    whatsapp_api_token TEXT NOT NULL DEFAULT '',
    whatsapp_phone_number_id VARCHAR(100) NOT NULL DEFAULT '',
    whatsapp_template TEXT NOT NULL DEFAULT 'Hello {customer_name}, thank you for shopping at {store_name}! Your Bill {bill_no} for Rs.{grand_total} ({items_summary}) is confirmed. Visit us again!',
    -- Mobile SMS Automation
    sms_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sms_provider VARCHAR(30) NOT NULL DEFAULT 'fast2sms',
    sms_api_key TEXT NOT NULL DEFAULT '',
    sms_sender_id VARCHAR(50) NOT NULL DEFAULT '',
    sms_template TEXT NOT NULL DEFAULT 'Thank you {customer_name} for shopping at {store_name}. Bill {bill_no}, Total Rs.{grand_total}. Have a great day!',
    -- Cloud Sync Metadata
    cloud_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    cloud_sync_url VARCHAR(300) NOT NULL DEFAULT '',
    cloud_sync_secret VARCHAR(150) NOT NULL DEFAULT 'change-me-sync-secret',
    last_synced_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO automation_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS notification_logs (
    id BIGSERIAL PRIMARY KEY,
    bill_id BIGINT REFERENCES bills(id) ON DELETE SET NULL,
    bill_no VARCHAR(40) NOT NULL DEFAULT '',
    customer_name VARCHAR(180) NOT NULL DEFAULT '',
    customer_phone VARCHAR(30) NOT NULL DEFAULT '',
    channel VARCHAR(20) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
    message_text TEXT NOT NULL DEFAULT '',
    message_preview TEXT DEFAULT '',
    provider_response TEXT DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotent forward-compatibility column guards across cloud & mirror databases
ALTER TABLE bills ADD COLUMN IF NOT EXISTS customer_city VARCHAR(120) DEFAULT '';
ALTER TABLE bills ADD COLUMN IF NOT EXISTS customer_gstin VARCHAR(30) DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS alt_phone VARCHAR(30) DEFAULT '';
ALTER TABLE automation_settings ADD COLUMN IF NOT EXISTS printer_mode VARCHAR(30) NOT NULL DEFAULT 'browser';
ALTER TABLE automation_settings ADD COLUMN IF NOT EXISTS printer_device_name VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE automation_settings ADD COLUMN IF NOT EXISTS silent_print BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS customer_name VARCHAR(180) NOT NULL DEFAULT '';
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS message_text TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_notification_logs_created ON notification_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_bill ON notification_logs (bill_id);
