import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// Mock db before importing app/router code so handlers see the stub.
const mockQuery = vi.fn();
vi.mock("../src/db/client.js", () => ({
  query: mockQuery,
  pool: { query: mockQuery, end: vi.fn() },
  shutdown: vi.fn(),
}));

const { app } = await import("../src/app.js");

describe("SIWE nonce flow", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("GET /api/auth/nonce returns a nonce and persists a row", async () => {
    mockQuery.mockResolvedValueOnce([]); // INSERT siwe_nonces returns no rows

    const res = await request(app).get("/api/auth/nonce");

    expect(res.status).toBe(200);
    expect(typeof res.body.nonce).toBe("string");
    expect(res.body.nonce.length).toBeGreaterThanOrEqual(8);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO siwe_nonces/i);
    expect(params[0]).toBe(res.body.nonce);
    expect(params[1]).toBeInstanceOf(Date);
    // expires_at must be in the future
    expect((params[1] as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it("POST /api/auth/siwe rejects when nonce row is missing", async () => {
    // The handler parses the SIWE message first, then queries the nonce row.
    // We supply a syntactically valid message; the nonce query returns [].
    const message = [
      "localhost wants you to sign in with your Ethereum account:",
      "0x0000000000000000000000000000000000000001",
      "",
      "Sign in",
      "",
      "URI: http://localhost",
      "Version: 1",
      "Chain ID: 11155111",
      "Nonce: abcdefgh12345678",
      "Issued At: 2024-01-01T00:00:00.000Z",
    ].join("\n");

    mockQuery.mockResolvedValueOnce([]); // nonce lookup returns nothing

    const res = await request(app)
      .post("/api/auth/siwe")
      .send({ message, signature: "0xdeadbeef" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unknown nonce");
  });

  it("POST /api/auth/siwe rejects when nonce is expired", async () => {
    const message = [
      "localhost wants you to sign in with your Ethereum account:",
      "0x0000000000000000000000000000000000000001",
      "",
      "Sign in",
      "",
      "URI: http://localhost",
      "Version: 1",
      "Chain ID: 11155111",
      "Nonce: expirednonce0000",
      "Issued At: 2024-01-01T00:00:00.000Z",
    ].join("\n");

    // First query: SELECT nonce returns expired row
    mockQuery.mockResolvedValueOnce([
      { nonce: "expirednonce0000", expires_at: new Date(Date.now() - 60_000) },
    ]);
    // Second query: DELETE expired nonce
    mockQuery.mockResolvedValueOnce([]);

    const res = await request(app)
      .post("/api/auth/siwe")
      .send({ message, signature: "0xdeadbeef" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("expired nonce");
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls[1][0]).toMatch(/DELETE FROM siwe_nonces/i);
  });

  it("POST /api/auth/siwe rejects missing fields with 401", async () => {
    const res = await request(app).post("/api/auth/siwe").send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("missing fields");
  });
});
