import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const mockQuery = vi.fn();
vi.mock("../src/db/client.js", () => ({
  query: mockQuery,
  pool: { query: mockQuery, end: vi.fn() },
  shutdown: vi.fn(),
}));

const { app } = await import("../src/app.js");
const { issueSession } = await import("../src/auth/session.js");

const ALICE = "0xAliceaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BOB = "0xBobbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const aliceToken = issueSession(ALICE);
const bobToken = issueSession(BOB);

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("drafts owner scoping", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("requires SIWE session", async () => {
    const res = await request(app).get("/api/drafts/draft_x");
    expect(res.status).toBe(401);
  });

  it("GET on draft owned by other returns 404 (not 403)", async () => {
    // SELECT scoped by owner → returns [] when Bob asks for Alice's draft
    mockQuery.mockResolvedValueOnce([]);

    const res = await request(app)
      .get("/api/drafts/draft_alice")
      .set(bearer(bobToken));

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("PUT on draft owned by other returns 404", async () => {
    // SELECT existing scoped by owner returns []
    mockQuery.mockResolvedValueOnce([]);

    const res = await request(app)
      .put("/api/drafts/draft_alice")
      .set(bearer(bobToken))
      .send({ name: "stolen" });

    expect(res.status).toBe(404);
  });

  it("DELETE on someone else's draft is silent 204 (and never deletes anything)", async () => {
    mockQuery.mockResolvedValueOnce([]); // DELETE returns no rows; harmless

    const res = await request(app)
      .delete("/api/drafts/draft_alice")
      .set(bearer(bobToken));

    expect(res.status).toBe(204);
    // Even though we returned 204, the SQL must include the owner predicate
    // so it can never affect Alice's row.
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/LOWER\(owner_address\)\s*=\s*\$2/i);
    expect(params[1]).toBe(BOB.toLowerCase());
  });

  it("PUT bumps draft_version", async () => {
    // SELECT returns the row at version 1
    mockQuery.mockResolvedValueOnce([
      {
        draft_id: "draft_alice",
        owner_address: ALICE.toLowerCase(),
        current_step: 1,
        status: "draft",
        campaign_address: null,
        draft_version: 1,
        name: "old",
        description: null,
        auditor_address: null,
        recipient_addrs: [],
        amounts_ciphertext: null,
        amounts_iv: null,
        wrapped_dek: null,
        wrapped_dek_iv: null,
        scope_json: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    // UPDATE returns row with bumped version
    mockQuery.mockResolvedValueOnce([
      {
        draft_id: "draft_alice",
        owner_address: ALICE.toLowerCase(),
        current_step: 2,
        status: "draft",
        campaign_address: null,
        draft_version: 2,
        name: "new",
        description: null,
        auditor_address: null,
        recipient_addrs: [],
        amounts_ciphertext: null,
        amounts_iv: null,
        wrapped_dek: null,
        wrapped_dek_iv: null,
        scope_json: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const res = await request(app)
      .put("/api/drafts/draft_alice")
      .set(bearer(aliceToken))
      .send({ name: "new", currentStep: 2 });

    expect(res.status).toBe(200);
    expect(res.body.draftVersion).toBe(2);

    // The UPDATE statement must include `draft_version = draft_version + 1`
    const updateSql = mockQuery.mock.calls[1][0] as string;
    expect(updateSql).toMatch(/draft_version\s*=\s*draft_version\s*\+\s*1/i);
  });

  it("returns 409 when expectedDraftVersion is stale", async () => {
    // Current row is at version 6; client thinks it's at 5
    mockQuery.mockResolvedValueOnce([
      {
        draft_id: "draft_alice",
        owner_address: ALICE.toLowerCase(),
        current_step: 1,
        status: "draft",
        campaign_address: null,
        draft_version: 6,
        name: "x",
        description: null,
        auditor_address: null,
        recipient_addrs: [],
        amounts_ciphertext: null,
        amounts_iv: null,
        wrapped_dek: null,
        wrapped_dek_iv: null,
        scope_json: null,
        created_at: new Date(),
        updated_at: new Date("2026-01-01T00:00:00Z"),
      },
    ]);

    const res = await request(app)
      .put("/api/drafts/draft_alice")
      .set(bearer(aliceToken))
      .send({ expectedDraftVersion: 5, name: "stale" });

    expect(res.status).toBe(409);
    expect(res.body.currentDraftVersion).toBe(6);
    expect(res.body.lastUpdatedAt).toBeDefined();
    // No UPDATE should have been issued.
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it("ignores non-whitelisted fields (e.g. owner_address)", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        draft_id: "draft_alice",
        owner_address: ALICE.toLowerCase(),
        current_step: 1,
        status: "draft",
        campaign_address: null,
        draft_version: 1,
        name: null,
        description: null,
        auditor_address: null,
        recipient_addrs: [],
        amounts_ciphertext: null,
        amounts_iv: null,
        wrapped_dek: null,
        wrapped_dek_iv: null,
        scope_json: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);
    mockQuery.mockResolvedValueOnce([
      {
        draft_id: "draft_alice",
        owner_address: ALICE.toLowerCase(),
        current_step: 1,
        status: "draft",
        campaign_address: null,
        draft_version: 2,
        name: "x",
        description: null,
        auditor_address: null,
        recipient_addrs: [],
        amounts_ciphertext: null,
        amounts_iv: null,
        wrapped_dek: null,
        wrapped_dek_iv: null,
        scope_json: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    await request(app)
      .put("/api/drafts/draft_alice")
      .set(bearer(aliceToken))
      .send({
        name: "x",
        owner_address: "0xBADBADBADBADBADBADBADBADBADBADBADBADBADB",
        draft_id: "draft_evil",
      });

    const updateSql = mockQuery.mock.calls[1][0] as string;
    // The unknown owner_address / draft_id keys must NOT appear in the SET clause.
    expect(updateSql).not.toMatch(/owner_address\s*=/i);
    // (draft_id appears in WHERE, not SET — assert no `SET ... draft_id =`)
    const setPortion = updateSql.split("WHERE")[0];
    expect(setPortion).not.toMatch(/draft_id\s*=/i);
  });

  it("POST creates draft owned by session address", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        draft_id: "draft_xyz",
        owner_address: ALICE.toLowerCase(),
        current_step: 1,
        status: "draft",
        campaign_address: null,
        draft_version: 1,
        name: "x",
        description: null,
        auditor_address: null,
        recipient_addrs: [],
        amounts_ciphertext: null,
        amounts_iv: null,
        wrapped_dek: null,
        wrapped_dek_iv: null,
        scope_json: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const res = await request(app)
      .post("/api/drafts")
      .set(bearer(aliceToken))
      .send({ name: "x" });

    expect(res.status).toBe(201);
    expect(res.body.ownerAddress).toBe(ALICE.toLowerCase());
    expect(res.body.draftVersion).toBe(1);

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO campaign_drafts/i);
    expect(params[0]).toMatch(/^draft_/);
    expect(params[1]).toBe(ALICE.toLowerCase());
  });
});
