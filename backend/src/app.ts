import express from "express";
import cors from "cors";
import { config } from "./config.js";

export const app = express();
app.use(cors({ origin: `http://${config.SIWE_DOMAIN}`, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
