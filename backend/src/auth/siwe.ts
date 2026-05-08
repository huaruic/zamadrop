import { Router } from "express";
import { generateNonce, SiweMessage } from "siwe";
import { z } from "zod";
import { query } from "../db/client.js";
import { issueSession } from "./session.js";
import { config } from "../config.js";

export const authRouter = Router();

/**
 * GET /api/auth/nonce
 *
 * Issues a fresh random SIWE nonce, persists it with a TTL row in `siwe_nonces`,
 * and returns the nonce string. The frontend embeds this nonce in the SIWE
 * message it asks the wallet to sign.
 */
authRouter.get("/nonce", async (_req, res) => {
  const nonce = generateNonce();
  const expiresAt = new Date(Date.now() + config.SIWE_NONCE_TTL_SECONDS * 1000);
  await query(
    "INSERT INTO siwe_nonces (nonce, expires_at) VALUES ($1, $2)",
    [nonce, expiresAt]
  );
  res.json({ nonce });
});

const verifyBody = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
});

/**
 * POST /api/auth/siwe
 *
 * Verifies a SIWE message:
 *   - Body must be { message, signature }.
 *   - Nonce row must exist in `siwe_nonces` and not yet be expired.
 *   - SiweMessage.verify({ signature }) must succeed.
 *
 * On success the nonce row is deleted (one-shot use) and a JWT session
 * bound to the recovered (lowercased) address is returned.
 */
authRouter.post("/siwe", async (req, res) => {
  const parsed = verifyBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(401).json({ error: "missing fields" });
  }
  const { message, signature } = parsed.data;

  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(message);
  } catch {
    return res.status(401).json({ error: "invalid message" });
  }

  // nonce must exist and not be expired
  const rows = await query<{ nonce: string; expires_at: Date }>(
    "SELECT nonce, expires_at FROM siwe_nonces WHERE nonce = $1",
    [siwe.nonce]
  );
  if (rows.length === 0) {
    return res.status(401).json({ error: "unknown nonce" });
  }
  const expiresAt = new Date(rows[0].expires_at);
  if (expiresAt.getTime() <= Date.now()) {
    // expired – clean it up so the table doesn't grow unbounded
    await query("DELETE FROM siwe_nonces WHERE nonce = $1", [siwe.nonce]);
    return res.status(401).json({ error: "expired nonce" });
  }

  let result;
  try {
    result = await siwe.verify({ signature, nonce: siwe.nonce });
  } catch {
    return res.status(401).json({ error: "verification failed" });
  }
  if (!result.success) {
    return res.status(401).json({ error: "verification failed" });
  }

  // one-shot: burn nonce on successful verification
  await query("DELETE FROM siwe_nonces WHERE nonce = $1", [siwe.nonce]);

  const address = result.data.address.toLowerCase();
  const sessionToken = issueSession(address);
  return res.json({ sessionToken, address });
});
