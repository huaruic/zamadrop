import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { authRouter } from "./auth/siwe.js";
import { campaignsRouter } from "./api/campaigns.js";
import { draftsRouter } from "./api/drafts.js";
import { registerRouter } from "./api/register.js";

export const app = express();
app.use(cors({ origin: `http://${config.SIWE_DOMAIN}`, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api", campaignsRouter);
app.use("/api", draftsRouter);
app.use("/api", registerRouter);
