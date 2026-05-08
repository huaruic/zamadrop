import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

const SESSION_TTL = "24h";

export function issueSession(address: string): string {
  return jwt.sign(
    { address: address.toLowerCase() },
    config.JWT_SECRET,
    { expiresIn: SESSION_TTL }
  );
}

export interface SessionRequest extends Request {
  session?: { address: string };
}

export function requireSession(
  req: SessionRequest,
  res: Response,
  next: NextFunction
) {
  const auth = req.header("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing bearer token" });
  }
  const token = auth.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as { address: string };
    req.session = { address: payload.address.toLowerCase() };
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}
