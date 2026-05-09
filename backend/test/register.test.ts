import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const mockQuery = vi.fn();
vi.mock("../src/db/client.js", () => ({
  query: mockQuery,
  pool: { query: mockQuery, end: vi.fn() },
  shutdown: vi.fn(),
}));

// Mock viem's createPublicClient so we can stub readContract per-test.
const mockReadContract = vi.fn();
const mockGetBlockNumber = vi.fn(async () => 100n);
const mockGetTransactionReceipt = vi.fn(async () => ({ blockNumber: 42n }));
vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: mockReadContract,
      getBlockNumber: mockGetBlockNumber,
      getTransactionReceipt: mockGetTransactionReceipt,
      getLogs: vi.fn(async () => []),
    })),
  };
});

const { app } = await import("../src/app.js");

const CAMPAIGN = "0x1111111111111111111111111111111111111111";
const ADMIN_REAL = "0xAaaAaaaAaaAaaaaaaaaaAaaAaaAaaAaaAaaAaaaA";
const ADMIN_FAKE = "0xBbbBbbBbbBbbBbbBbbBbbBbbBbbBbbBbbBbbBbbB";
const AUDITOR = "0xCccCccCccCccCccCccCccCccCccCccCccCccCccc";
const TOKEN = "0xDddDddDddDddDddDddDddDddDddDddDddDddDddd";
const HASH = "0x" + "ab".repeat(32);

function stubChainReads(adminVal = ADMIN_REAL, stateVal = 0) {
  mockReadContract.mockImplementation(async ({ functionName }: any) => {
    switch (functionName) {
      case "admin":
        return adminVal;
      case "auditor":
        return AUDITOR;
      case "token":
        return TOKEN;
      case "recipientListHash":
        return HASH;
      case "declaredTotal":
        return 1000n;
      case "recipientCount":
        return 3n;
      case "state":
        return stateVal;
      default:
        throw new Error(`unexpected fn ${functionName}`);
    }
  });
}

describe("POST /api/register-campaign", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockReadContract.mockReset();
    mockGetBlockNumber.mockClear();
    mockGetBlockNumber.mockResolvedValue(100n);
    mockGetTransactionReceipt.mockClear();
    mockGetTransactionReceipt.mockResolvedValue({ blockNumber: 42n });
  });

  it("rejects with 400 when claimed admin doesn't match on-chain admin", async () => {
    stubChainReads(ADMIN_REAL);

    const res = await request(app).post("/api/register-campaign").send({
      address: CAMPAIGN,
      admin: ADMIN_FAKE, // mismatch with chain
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("admin mismatch on-chain");
    // No DB write should have happened.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("inserts campaign using chain-verified values when admin matches", async () => {
    stubChainReads(ADMIN_REAL);
    mockQuery.mockResolvedValue([]);

    // Body uses lowercase hex; chain returns mixed case. Comparison must be
    // case-insensitive.
    const res = await request(app).post("/api/register-campaign").send({
      address: CAMPAIGN,
      admin: ADMIN_REAL.toLowerCase(),
      name: "Test",
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    expect(mockQuery).toHaveBeenCalled();
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO campaigns/i);
    expect(params[0]).toBe(CAMPAIGN); // address
    expect(params[1]).toBe(ADMIN_REAL); // chain admin, NOT body admin
    expect(params[2]).toBe(AUDITOR); // chain auditor
    expect(params[3]).toBe(TOKEN); // chain token
    expect(params[4]).toBe("1000"); // declared_total stringified
    expect(params[5]).toBe(3); // recipient_count
    expect(params[6]).toBe(HASH);
    expect(params[7]).toBe("setup"); // mapped chain state
    expect(params[8]).toBe("Test"); // name
    expect(params[9]).toBeNull(); // description
    expect(params[10]).toBe("100"); // deployed_at_block fallback = current tip
    expect(params[11]).toBeNull(); // deployed_tx_hash absent
    expect(params[12]).toBe("99"); // last_indexed_block = deployed - 1
  });

  it("maps chain state index to lowercase string", async () => {
    stubChainReads(ADMIN_REAL, 2); // Claiming
    mockQuery.mockResolvedValue([]);

    const res = await request(app).post("/api/register-campaign").send({
      address: CAMPAIGN,
      admin: ADMIN_REAL,
    });

    expect(res.status).toBe(200);
    const params = mockQuery.mock.calls[0][1];
    expect(params[7]).toBe("claiming");
  });

  it("uses tx receipt block when deployedTxHash provided", async () => {
    stubChainReads(ADMIN_REAL);
    mockQuery.mockResolvedValue([]);
    const txHash = "0x" + "ab".repeat(32);

    const res = await request(app).post("/api/register-campaign").send({
      address: CAMPAIGN,
      admin: ADMIN_REAL,
      deployedTxHash: txHash,
    });

    expect(res.status).toBe(200);
    expect(mockGetTransactionReceipt).toHaveBeenCalled();
    const params = mockQuery.mock.calls[0][1];
    expect(params[10]).toBe("42"); // deployed_at_block from receipt
    expect(params[11]).toBe(txHash); // deployed_tx_hash recorded
    expect(params[12]).toBe("41"); // last_indexed_block = deployed - 1
  });

  it("rejects malformed body with 400", async () => {
    const res = await request(app)
      .post("/api/register-campaign")
      .send({ address: "not-an-address", admin: ADMIN_REAL });
    expect(res.status).toBe(400);
  });

  it("updates draft when draftId provided", async () => {
    stubChainReads(ADMIN_REAL);
    mockQuery.mockResolvedValue([]);

    const res = await request(app).post("/api/register-campaign").send({
      address: CAMPAIGN,
      admin: ADMIN_REAL,
      draftId: "draft_abc",
    });

    expect(res.status).toBe(200);
    // 2 queries: INSERT campaigns + UPDATE campaign_drafts
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const updateSql = mockQuery.mock.calls[1][0] as string;
    expect(updateSql).toMatch(/UPDATE campaign_drafts/i);
    expect(updateSql).toMatch(/status\s*=\s*'deployed'/i);
  });
});
