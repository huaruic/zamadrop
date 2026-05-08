-- ZamaDrop Postgres schema
-- Idempotent: re-running this script is a no-op.

CREATE TABLE IF NOT EXISTS campaigns (
  address TEXT PRIMARY KEY,
  admin TEXT NOT NULL,
  auditor TEXT NOT NULL,
  token TEXT NOT NULL,
  declared_total NUMERIC(20, 0) NOT NULL,
  recipient_count INT NOT NULL,
  recipient_list_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'setup',
  name TEXT,
  description TEXT,
  deployed_at_block BIGINT,
  deployed_tx_hash TEXT,
  finalized_at_block BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_admin ON campaigns (admin);
CREATE INDEX IF NOT EXISTS idx_campaigns_auditor ON campaigns (auditor);
CREATE INDEX IF NOT EXISTS idx_campaigns_state ON campaigns (state);

CREATE TABLE IF NOT EXISTS allocations (
  campaign_address TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  tx_hash TEXT NOT NULL,
  PRIMARY KEY (campaign_address, recipient_address)
);

CREATE INDEX IF NOT EXISTS idx_allocations_recipient ON allocations (recipient_address);

CREATE TABLE IF NOT EXISTS claims (
  campaign_address TEXT NOT NULL,
  user_address TEXT NOT NULL,
  amount NUMERIC(20, 0),
  claimed_at_block BIGINT,
  transferred_at_block BIGINT,
  PRIMARY KEY (campaign_address, user_address)
);

CREATE TABLE IF NOT EXISTS campaign_drafts (
  draft_id TEXT PRIMARY KEY,
  owner_address TEXT NOT NULL,
  current_step INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  campaign_address TEXT,
  draft_version INT NOT NULL DEFAULT 1,
  name TEXT,
  description TEXT,
  auditor_address TEXT,
  recipient_addrs JSONB NOT NULL DEFAULT '[]'::jsonb,
  amounts_ciphertext TEXT,
  amounts_iv TEXT,
  wrapped_dek TEXT,
  wrapped_dek_iv TEXT,
  scope_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_drafts_owner ON campaign_drafts (owner_address);

CREATE TABLE IF NOT EXISTS siwe_nonces (
  nonce TEXT PRIMARY KEY,
  address TEXT,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_siwe_nonces_expires ON siwe_nonces (expires_at);

CREATE TABLE IF NOT EXISTS kv_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
