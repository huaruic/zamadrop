// Vitest setup: populate env vars before any module that imports `config.ts`
// is evaluated. Vitest auto-runs files referenced via `setupFiles` before
// each test file.
process.env.PORT ??= "3001";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test_db";
process.env.JWT_SECRET ??= "test-jwt-secret-at-least-16-chars";
process.env.SEPOLIA_RPC ??= "http://localhost:8545";
process.env.CHAIN_ID ??= "11155111";
process.env.SIWE_DOMAIN ??= "localhost:5173";
process.env.SIWE_NONCE_TTL_SECONDS ??= "300";
