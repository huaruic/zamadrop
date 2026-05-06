import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(16),
  SEPOLIA_RPC: z.string().url(),
  CHAIN_ID: z.coerce.number(),
  SIWE_DOMAIN: z.string(),
  SIWE_NONCE_TTL_SECONDS: z.coerce.number().default(300),
});

export const config = schema.parse(process.env);
