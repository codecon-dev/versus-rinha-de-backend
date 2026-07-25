CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE accounts (
    id VARCHAR(64) PRIMARY KEY,
    balance BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE transfers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payer_id VARCHAR(64) NOT NULL REFERENCES accounts(id),
    payee_id VARCHAR(64) NOT NULL REFERENCES accounts(id),
    amount BIGINT NOT NULL,
    idempotency_key VARCHAR(128) UNIQUE,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    failure_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- Índice que serve o worker: as pendentes, na ordem em que chegaram
CREATE INDEX idx_transfers_pending ON transfers (created_at) WHERE status = 'pending';
CREATE INDEX idx_transfers_payer ON transfers (payer_id);
CREATE INDEX idx_transfers_payee ON transfers (payee_id);
CREATE INDEX idx_transfers_status ON transfers (status);
