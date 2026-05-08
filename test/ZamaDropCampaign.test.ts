import { expect } from "chai";
import hre, { ethers } from "hardhat";
import { FhevmType } from "@fhevm/mock-utils";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// 测试辅助：创建加密的 uint64 输入
async function encryptAmount(
  contractAddress: string,
  senderAddress: string,
  value: bigint
): Promise<{ handle: string; proof: Uint8Array }> {
  const input = hre.fhevm.createEncryptedInput(contractAddress, senderAddress);
  input.add64(value);
  const encrypted = await input.encrypt();
  return { handle: encrypted.handles[0], proof: encrypted.inputProof };
}

// bulk-allocation 测试辅助：把 N 个 uint64 amount 打包成同一个 input proof，
// 模拟前端 wizard 走 setAllocationsBatch 时 relayer SDK 对单批 ≤32 amounts
// 共享一个 proof 的行为。
async function encryptAmountsBatch(
  contractAddress: string,
  senderAddress: string,
  values: bigint[]
): Promise<{ handles: string[]; proof: Uint8Array }> {
  const input = hre.fhevm.createEncryptedInput(contractAddress, senderAddress);
  for (const v of values) input.add64(v);
  const encrypted = await input.encrypt();
  return { handles: encrypted.handles, proof: encrypted.inputProof };
}

// publicDecrypt + KMS proof helper. KMS 改造后 callbackFinalize / executeTransfer
// 需要 decryptionProof 参数；mock-utils 在 hardhat 环境下会自动生成有效签名。
async function publicDecryptWithProof(handle: string): Promise<{
  ebool: boolean;
  euint: bigint;
  decryptionProof: string;
}> {
  const result = await hre.fhevm.publicDecrypt([handle]);
  const clear = result.clearValues[handle];
  return {
    ebool: clear as boolean,
    euint: clear as bigint,
    decryptionProof: result.decryptionProof,
  };
}

// 计算 recipientList hash（与合约里 keccak256(abi.encode(recipients)) 对齐）
function computeListHash(recipients: string[]): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address[]"], [recipients])
  );
}

interface DeployOpts {
  admin: HardhatEthersSigner;
  auditor: HardhatEthersSigner;
  recipients: string[];
  declaredTotal?: bigint;
  fundEscrow?: bigint | "declared" | false; // false = no fund, "declared" = declaredTotal, bigint = explicit
  tokenSupply?: bigint; // 给 admin 的初始 token 余额；默认 = declaredTotal
  listHashOverride?: string; // 测试 hash mismatch 时用
}

interface DeployResult {
  campaign: Awaited<ReturnType<typeof ethers.getContractAt>>;
  campaignAddress: string;
  token: Awaited<ReturnType<typeof ethers.getContractAt>>;
  tokenAddress: string;
  listHash: string;
}

async function deployCampaign(opts: DeployOpts): Promise<DeployResult> {
  const declaredTotal = opts.declaredTotal ?? 1000n;
  const tokenSupply = opts.tokenSupply ?? declaredTotal;

  const TokenFactory = await ethers.getContractFactory("MockToken");
  const token = await TokenFactory.connect(opts.admin).deploy(
    "ZamaDrop Test Token",
    "ZDT",
    tokenSupply,
    opts.admin.address
  );
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  const listHash = opts.listHashOverride ?? computeListHash(opts.recipients);

  const Factory = await ethers.getContractFactory("ZamaDropCampaign");
  const deployed = await Factory.connect(opts.admin).deploy(
    opts.admin.address,
    opts.auditor.address,
    tokenAddress,
    declaredTotal,
    opts.recipients,
    listHash
  );
  await deployed.waitForDeployment();
  const campaignAddress = await deployed.getAddress();
  const campaign = await ethers.getContractAt("ZamaDropCampaign", campaignAddress);
  const tokenContract = await ethers.getContractAt("MockToken", tokenAddress);

  // Default: fund escrow with declaredTotal so legacy finalize tests pass
  const fund = opts.fundEscrow ?? "declared";
  if (fund !== false) {
    const amount = fund === "declared" ? declaredTotal : fund;
    await token.connect(opts.admin).transfer(campaignAddress, amount);
  }

  return { campaign, campaignAddress, token: tokenContract, tokenAddress, listHash };
}

describe("ZamaDropCampaign", function () {
  let contractAddress: string;
  let contract: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let tokenContract: Awaited<ReturnType<typeof ethers.getContractAt>>;
  let admin: HardhatEthersSigner;
  let recipient1: HardhatEthersSigner;
  let recipient2: HardhatEthersSigner;
  let auditor: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  const DECLARED_TOTAL = 1000n;
  const ALLOC_1 = 600n;
  const ALLOC_2 = 400n; // 总和 = 1000 = DECLARED_TOTAL

  beforeEach(async function () {
    [admin, recipient1, recipient2, auditor, other] = await ethers.getSigners();

    const result = await deployCampaign({
      admin,
      auditor,
      recipients: [recipient1.address, recipient2.address],
      declaredTotal: DECLARED_TOTAL,
    });
    contract = result.campaign;
    contractAddress = result.campaignAddress;
    tokenContract = result.token;
  });

  // ─────────────────────────────────────────────
  // 部署和初始状态
  // ─────────────────────────────────────────────
  describe("部署初始状态", function () {
    it("应正确设置 declaredTotal、recipientCount、admin、auditor", async function () {
      expect(await contract.declaredTotal()).to.equal(DECLARED_TOTAL);
      expect(await contract.recipientCount()).to.equal(2n);
      expect(await contract.admin()).to.equal(admin.address);
      expect(await contract.auditor()).to.equal(auditor.address);
      expect(await contract.finalized()).to.equal(false);
    });

    it("recipientListHash getter 返回构造器传入的 hash", async function () {
      const expected = computeListHash([recipient1.address, recipient2.address]);
      expect(await contract.recipientListHash()).to.equal(expected);
    });

    it("deployer ≠ admin: admin() 返回构造器参数而不是 msg.sender", async function () {
      // 用 `other` 作为部署者，admin 显式传入 admin（不同地址）
      const TokenFactory = await ethers.getContractFactory("MockToken");
      const freshToken = await TokenFactory.connect(other).deploy(
        "ZDT",
        "ZDT",
        DECLARED_TOTAL,
        admin.address
      );
      await freshToken.waitForDeployment();

      const recipients = [recipient1.address, recipient2.address];
      const listHash = computeListHash(recipients);

      const Factory = await ethers.getContractFactory("ZamaDropCampaign");
      // other 部署，但 admin_ = admin
      const deployed = await Factory.connect(other).deploy(
        admin.address,
        auditor.address,
        await freshToken.getAddress(),
        DECLARED_TOTAL,
        recipients,
        listHash
      );
      await deployed.waitForDeployment();

      expect(await deployed.admin()).to.equal(admin.address);
      expect(await deployed.admin()).to.not.equal(other.address);
    });

    it("hash 不一致时部署应 revert HashMismatch", async function () {
      const recipients = [recipient1.address, recipient2.address];
      const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("wrong"));

      const TokenFactory = await ethers.getContractFactory("MockToken");
      const freshToken = await TokenFactory.connect(admin).deploy(
        "ZDT",
        "ZDT",
        DECLARED_TOTAL,
        admin.address
      );
      await freshToken.waitForDeployment();

      const Factory = await ethers.getContractFactory("ZamaDropCampaign");
      await expect(
        Factory.connect(admin).deploy(
          admin.address,
          auditor.address,
          await freshToken.getAddress(),
          DECLARED_TOTAL,
          recipients,
          wrongHash
        )
      ).to.be.revertedWithCustomError(Factory, "HashMismatch");
    });
  });

  // ─────────────────────────────────────────────
  // setAllocation
  // ─────────────────────────────────────────────
  describe("setAllocation", function () {
    it("Admin 可以成功设置 allocation", async function () {
      const { handle, proof } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await expect(
        contract.connect(admin).setAllocation(recipient1.address, handle, proof)
      ).to.not.be.reverted;

      expect(await contract.allocationSet(recipient1.address)).to.equal(true);
    });

    it("非 Admin 调用 setAllocation 应 revert", async function () {
      const { handle, proof } = await encryptAmount(contractAddress, other.address, ALLOC_1);
      await expect(
        contract.connect(other).setAllocation(recipient1.address, handle, proof)
      ).to.be.revertedWithCustomError(contract, "NotAdmin");
    });

    it("对同一地址重复设置 allocation 应 revert", async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);

      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await expect(
        contract.connect(admin).setAllocation(recipient1.address, h2, p2)
      ).to.be.revertedWithCustomError(contract, "AllocationAlreadySet");
    });

    it("allocationCount 每次 setAllocation 后递增", async function () {
      expect(await contract.allocationCount()).to.equal(0n);

      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      expect(await contract.allocationCount()).to.equal(1n);

      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);
      expect(await contract.allocationCount()).to.equal(2n);
    });

    it("Finalizing 状态下（callback 未到）setAllocation 应 revert AlreadyFinalized", async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize(); // → Finalizing，未回调

      const { handle: h3, proof: p3 } = await encryptAmount(contractAddress, admin.address, 50n);
      await expect(
        contract.connect(admin).setAllocation(other.address, h3, p3)
      ).to.be.revertedWithCustomError(contract, "AlreadyFinalized");
    });

    it("finalize 之后不可再设置 allocation", async function () {
      // 设置所有 allocation
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      // finalize
      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);

      // 尝试再设置
      const { handle: h3, proof: p3 } = await encryptAmount(contractAddress, admin.address, 100n);
      await expect(
        contract.connect(admin).setAllocation(other.address, h3, p3)
      ).to.be.revertedWithCustomError(contract, "AlreadyFinalized");
    });
  });

  // ─────────────────────────────────────────────
  // setAllocationsBatch — bulk-allocation
  // ─────────────────────────────────────────────
  describe("setAllocationsBatch", function () {
    it("batch of 2 happy path: state、allocationCount、events 与 single-call 等价", async function () {
      const { handles, proof } = await encryptAmountsBatch(
        contractAddress,
        admin.address,
        [ALLOC_1, ALLOC_2]
      );

      const tx = await contract
        .connect(admin)
        .setAllocationsBatch([recipient1.address, recipient2.address], handles, proof);
      const receipt = await tx.wait();

      expect(await contract.allocationCount()).to.equal(2n);
      expect(await contract.allocationSet(recipient1.address)).to.equal(true);
      expect(await contract.allocationSet(recipient2.address)).to.equal(true);

      // 每个 recipient 都该 emit 一次 AllocationSet
      const allocEvents = receipt!.logs.filter(
        (log: { topics: ReadonlyArray<string> }) =>
          log.topics[0] === contract.interface.getEvent("AllocationSet")!.topicHash
      );
      expect(allocEvents.length).to.equal(2);

      // 后续 finalize 应该过 — 状态跟单调用路径完全一致
      await tokenContract
        .connect(admin)
        .transfer(contractAddress, DECLARED_TOTAL - DECLARED_TOTAL); // already funded by deployCampaign
      await expect(contract.connect(admin).finalize()).to.not.be.reverted;
    });

    it("非 Admin 调用 setAllocationsBatch 应 revert NotAdmin", async function () {
      const { handles, proof } = await encryptAmountsBatch(
        contractAddress,
        other.address,
        [ALLOC_1, ALLOC_2]
      );
      await expect(
        contract
          .connect(other)
          .setAllocationsBatch([recipient1.address, recipient2.address], handles, proof)
      ).to.be.revertedWithCustomError(contract, "NotAdmin");
    });

    it("array 长度对不上应 revert ArrayLengthMismatch", async function () {
      const { handles, proof } = await encryptAmountsBatch(
        contractAddress,
        admin.address,
        [ALLOC_1, ALLOC_2]
      );
      // 3 个 recipients vs 2 个 handles
      await expect(
        contract
          .connect(admin)
          .setAllocationsBatch(
            [recipient1.address, recipient2.address, other.address],
            handles,
            proof
          )
      ).to.be.revertedWithCustomError(contract, "ArrayLengthMismatch");
    });

    it("批内 recipient 重复应 revert AllocationAlreadySet", async function () {
      // 重新部署一个 3-recipient campaign 才能测批内重复
      const { campaign, campaignAddress } = await deployCampaign({
        admin,
        auditor,
        recipients: [recipient1.address, recipient2.address, other.address],
        declaredTotal: DECLARED_TOTAL,
      });
      const { handles, proof } = await encryptAmountsBatch(
        campaignAddress,
        admin.address,
        [ALLOC_1, ALLOC_2, 100n]
      );
      // recipient1 出现两次（位置 0 和 2）
      await expect(
        campaign
          .connect(admin)
          .setAllocationsBatch(
            [recipient1.address, recipient2.address, recipient1.address],
            handles,
            proof
          )
      ).to.be.revertedWithCustomError(campaign, "AllocationAlreadySet");
    });

    it("recipient 已被先前调用 set 过，再 batch 包含同一 recipient 应 revert", async function () {
      // 先 single-call 给 recipient1
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      expect(await contract.allocationSet(recipient1.address)).to.equal(true);

      // 再 batch 含 recipient1 + recipient2
      const { handles, proof } = await encryptAmountsBatch(
        contractAddress,
        admin.address,
        [ALLOC_1, ALLOC_2]
      );
      await expect(
        contract
          .connect(admin)
          .setAllocationsBatch([recipient1.address, recipient2.address], handles, proof)
      ).to.be.revertedWithCustomError(contract, "AllocationAlreadySet");

      // recipient2 不应被部分写入（atomic）
      expect(await contract.allocationSet(recipient2.address)).to.equal(false);
    });

    it("Finalizing 状态下 setAllocationsBatch 应 revert AlreadyFinalized", async function () {
      // 走完 setAllocation × 2 + finalize（state 进 Finalizing）
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);
      await contract.connect(admin).finalize(); // → Finalizing

      const { handles, proof } = await encryptAmountsBatch(
        contractAddress,
        admin.address,
        [50n]
      );
      await expect(
        contract.connect(admin).setAllocationsBatch([other.address], handles, proof)
      ).to.be.revertedWithCustomError(contract, "AlreadyFinalized");
    });

    it("单调用 + batch 混用收敛: allocationCount 累加正确，finalize 通过", async function () {
      // 重新部署 3-recipient campaign
      const { campaign, campaignAddress } = await deployCampaign({
        admin,
        auditor,
        recipients: [recipient1.address, recipient2.address, other.address],
        declaredTotal: 1000n,
      });

      // 先 single-call recipient1 = 300
      const { handle, proof } = await encryptAmount(campaignAddress, admin.address, 300n);
      await campaign.connect(admin).setAllocation(recipient1.address, handle, proof);
      expect(await campaign.allocationCount()).to.equal(1n);

      // 再 batch [recipient2, other] = [400, 300]，总和 = 1000 = declaredTotal
      const { handles: bh, proof: bp } = await encryptAmountsBatch(
        campaignAddress,
        admin.address,
        [400n, 300n]
      );
      await campaign
        .connect(admin)
        .setAllocationsBatch([recipient2.address, other.address], bh, bp);

      expect(await campaign.allocationCount()).to.equal(3n);
      expect(await campaign.allocationSet(recipient1.address)).to.equal(true);
      expect(await campaign.allocationSet(recipient2.address)).to.equal(true);
      expect(await campaign.allocationSet(other.address)).to.equal(true);

      // finalize 应该过（count + 总额都对得上）
      await expect(campaign.connect(admin).finalize()).to.not.be.reverted;
    });
  });

  // ─────────────────────────────────────────────
  // finalize
  // ─────────────────────────────────────────────
  describe("finalize", function () {
    it("总量正确时 callbackFinalize 应将 finalized 置为 true", async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);

      expect(result).to.equal(true);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);
      expect(await contract.finalized()).to.equal(true);
    });

    it("总量不符时 finalized 应保持 false", async function () {
      // 两个 recipient 都设置，但金额加起来 ≠ DECLARED_TOTAL，sumCheck 返回 false
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_1); // 故意错
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);

      expect(result).to.equal(false);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);
      expect(await contract.finalized()).to.equal(false);
    });

    it("非 Admin 调用 finalize 应 revert", async function () {
      await expect(
        contract.connect(other).finalize()
      ).to.be.revertedWithCustomError(contract, "NotAdmin");
    });

    it("allocationCount != recipientCount 时 finalize 以 CountMismatch revert", async function () {
      // 只设置 1 个 recipient（recipientCount = 2）
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);

      await expect(
        contract.connect(admin).finalize()
      ).to.be.revertedWithCustomError(contract, "CountMismatch");
    });

    it("allocationCount == recipientCount 时 finalize 通过 count 检查继续到 FHE 阶段", async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await expect(contract.connect(admin).finalize()).to.not.be.reverted;
      // FinalizeRequested 事件已发出，handle 不为零
      expect(await contract.finalizeCheckHandle()).to.not.equal(
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      );
    });

    it("escrow 不足时 finalize 以 NotFunded revert", async function () {
      // 部署一个不注资的 campaign
      const { campaign, campaignAddress } = await deployCampaign({
        admin,
        auditor,
        recipients: [recipient1.address, recipient2.address],
        declaredTotal: DECLARED_TOTAL,
        fundEscrow: false,
      });

      const { handle: h1, proof: p1 } = await encryptAmount(campaignAddress, admin.address, ALLOC_1);
      await campaign.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(campaignAddress, admin.address, ALLOC_2);
      await campaign.connect(admin).setAllocation(recipient2.address, h2, p2);

      await expect(
        campaign.connect(admin).finalize()
      ).to.be.revertedWithCustomError(campaign, "NotFunded");
    });

    it("escrow 恰好等于 declaredTotal 时 finalize 通过 NotFunded 检查", async function () {
      // 默认 helper 已注资 declaredTotal
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await expect(contract.connect(admin).finalize()).to.not.be.reverted;
    });

    it("KMS proof 校验下，任何账户都可提交 callbackFinalize（信任根是签名而非身份）", async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);

      await expect(
        contract.connect(other).callbackFinalize(result, decryptionProof)
      ).to.not.be.reverted;
      expect(await contract.finalized()).to.equal(true);
    });
  });

  // ─────────────────────────────────────────────
  // requestMyAllocation
  // ─────────────────────────────────────────────
  describe("requestMyAllocation", function () {
    beforeEach(async function () {
      // 设置 allocation 并 finalize
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);
    });

    it("受益人应能解密自己的 allocation", async function () {
      const handle = await contract.connect(recipient1).requestMyAllocation();
      const decrypted = await hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        handle,
        contractAddress,
        recipient1
      );
      expect(decrypted).to.equal(ALLOC_1);
    });

    it("受益人无法解密他人的 allocation（权限隔离）", async function () {
      // 先拿 recipient1 的 handle
      const handle = await contract.connect(recipient1).requestMyAllocation();
      // recipient2 尝试解密 recipient1 的 handle 应失败
      await expect(
        hre.fhevm.userDecryptEuint(
          FhevmType.euint64,
          handle,
          contractAddress,
          recipient2
        )
      ).to.be.rejected;
    });

    it("没有 allocation 的地址应 revert", async function () {
      await expect(
        contract.connect(other).requestMyAllocation()
      ).to.be.revertedWithCustomError(contract, "NoAllocation");
    });
  });

  // ─────────────────────────────────────────────
  // claim
  // ─────────────────────────────────────────────
  describe("claim", function () {
    beforeEach(async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);
    });

    it("受益人应能成功 claim 并更新 claimed 状态", async function () {
      await expect(contract.connect(recipient1).claim()).to.not.be.reverted;
      expect(await contract.claimed(recipient1.address)).to.equal(true);
    });

    it("重复 claim 应 revert", async function () {
      await contract.connect(recipient1).claim();
      await expect(
        contract.connect(recipient1).claim()
      ).to.be.revertedWithCustomError(contract, "AlreadyClaimed");
    });

    it("finalize 前 claim 应 revert", async function () {
      // 重新部署一个未 finalize 的合约
      const { campaign: fresh } = await deployCampaign({
        admin,
        auditor,
        recipients: [recipient1.address, recipient2.address],
        declaredTotal: DECLARED_TOTAL,
      });
      await expect(
        fresh.connect(recipient1).claim()
      ).to.be.revertedWithCustomError(fresh, "NotFinalized");
    });

    it("没有 allocation 的地址 claim 应 revert", async function () {
      await expect(
        contract.connect(other).claim()
      ).to.be.revertedWithCustomError(contract, "NoAllocation");
    });

    it("claim 后 claimedTotal 应累加（Auditor 可解密）", async function () {
      await contract.connect(recipient1).claim();
      await contract.connect(recipient2).claim();

      const handle = await contract.connect(auditor).requestClaimedTotalForAuditor();
      const total = await hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        handle,
        contractAddress,
        auditor
      );
      expect(total).to.equal(ALLOC_1 + ALLOC_2);
    });
  });

  // ─────────────────────────────────────────────
  // requestClaimedTotalForAuditor
  // ─────────────────────────────────────────────
  describe("requestClaimedTotalForAuditor", function () {
    it("非 Auditor 调用应 revert", async function () {
      await expect(
        contract.connect(other).requestClaimedTotalForAuditor()
      ).to.be.revertedWithCustomError(contract, "NotAuditor");
    });

    it("Auditor 初始解密 claimedTotal 应为 0", async function () {
      const handle = await contract.connect(auditor).requestClaimedTotalForAuditor();
      const total = await hre.fhevm.userDecryptEuint(
        FhevmType.euint64,
        handle,
        contractAddress,
        auditor
      );
      expect(total).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────
  // token integration
  // ─────────────────────────────────────────────
  describe("token integration", function () {
    beforeEach(async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);
    });

    it("claim 应发出 ClaimRequested 事件并存储 pendingClaimHandle", async function () {
      await expect(contract.connect(recipient1).claim())
        .to.emit(contract, "ClaimRequested");

      const pending = await contract.pendingClaimHandle(recipient1.address);
      expect(pending).to.not.equal(
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      );
    });

    it("executeTransfer 应成功转账并更新 transferred", async function () {
      await contract.connect(recipient1).claim();
      const pending = await contract.pendingClaimHandle(recipient1.address);
      const { decryptionProof } = await publicDecryptWithProof(pending);

      const balanceBefore = await tokenContract.balanceOf(recipient1.address);
      expect(balanceBefore).to.equal(0n);

      await expect(
        contract.connect(other).executeTransfer(recipient1.address, ALLOC_1, decryptionProof)
      )
        .to.emit(contract, "TokenTransferred")
        .withArgs(recipient1.address, ALLOC_1);

      expect(await contract.transferred(recipient1.address)).to.equal(true);
      expect(await tokenContract.balanceOf(recipient1.address)).to.equal(ALLOC_1);
    });

    it("KMS proof 校验下，任何账户都可提交 executeTransfer（信任根是签名而非身份）", async function () {
      await contract.connect(recipient1).claim();
      const pending = await contract.pendingClaimHandle(recipient1.address);
      const { decryptionProof } = await publicDecryptWithProof(pending);

      await expect(
        contract.connect(other).executeTransfer(recipient1.address, ALLOC_1, decryptionProof)
      ).to.not.be.reverted;
      expect(await contract.transferred(recipient1.address)).to.equal(true);
    });

    it("amount 与 KMS 解密结果不一致时应 revert（防伪造）", async function () {
      await contract.connect(recipient1).claim();
      const pending = await contract.pendingClaimHandle(recipient1.address);
      const { decryptionProof } = await publicDecryptWithProof(pending);

      // ALLOC_1 是 600，攻击者尝试虚报 9999
      await expect(
        contract.connect(other).executeTransfer(recipient1.address, 9999n, decryptionProof)
      ).to.be.reverted;
      expect(await contract.transferred(recipient1.address)).to.equal(false);
    });

    it("未 claim 时调用 executeTransfer 应 revert", async function () {
      // pendingClaimHandle[recipient2] 仍为 0，但 NotClaimed 在 checkSignatures 之前先 revert
      await expect(
        contract.connect(other).executeTransfer(recipient2.address, ALLOC_2, "0x")
      ).to.be.revertedWithCustomError(contract, "NotClaimed");
    });

    it("重复 executeTransfer 应 revert", async function () {
      await contract.connect(recipient1).claim();
      const pending = await contract.pendingClaimHandle(recipient1.address);
      const { decryptionProof } = await publicDecryptWithProof(pending);
      await contract.connect(other).executeTransfer(recipient1.address, ALLOC_1, decryptionProof);

      // 第二次调用：AlreadyTransferred 在 checkSignatures 之前先 revert
      await expect(
        contract.connect(other).executeTransfer(recipient1.address, ALLOC_1, "0x")
      ).to.be.revertedWithCustomError(contract, "AlreadyTransferred");
    });

    it("claim 后 pendingClaimHandle 可被 publicDecrypt 解密为正确 amount", async function () {
      await contract.connect(recipient1).claim();
      const pending = await contract.pendingClaimHandle(recipient1.address);
      const decrypted = await hre.fhevm.publicDecryptEuint(FhevmType.euint64, pending);
      expect(decrypted).to.equal(ALLOC_1);
    });

    it("claimedTotalPlaintext 在多次成功 executeTransfer 后累加", async function () {
      expect(await contract.claimedTotalPlaintext()).to.equal(0n);

      // recipient1 claim + executeTransfer
      await contract.connect(recipient1).claim();
      const pending1 = await contract.pendingClaimHandle(recipient1.address);
      const { decryptionProof: proof1 } = await publicDecryptWithProof(pending1);
      await contract.connect(other).executeTransfer(recipient1.address, ALLOC_1, proof1);
      expect(await contract.claimedTotalPlaintext()).to.equal(ALLOC_1);

      // recipient2 claim + executeTransfer
      await contract.connect(recipient2).claim();
      const pending2 = await contract.pendingClaimHandle(recipient2.address);
      const { decryptionProof: proof2 } = await publicDecryptWithProof(pending2);
      await contract.connect(other).executeTransfer(recipient2.address, ALLOC_2, proof2);
      expect(await contract.claimedTotalPlaintext()).to.equal(ALLOC_1 + ALLOC_2);
    });
  });

  // ─────────────────────────────────────────────
  // V7: state machine
  // ─────────────────────────────────────────────
  describe("state machine", function () {
    // enum State { Setup, Finalizing, Claiming, Failed }
    const STATE_SETUP = 0n;
    const STATE_FINALIZING = 1n;
    const STATE_CLAIMING = 2n;
    const STATE_FAILED = 3n;

    it("初始状态为 Setup", async function () {
      expect(await contract.state()).to.equal(STATE_SETUP);
    });

    it("finalize() 成功后进入 Finalizing", async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      expect(await contract.state()).to.equal(STATE_FINALIZING);
    });

    it("callbackFinalize(true) 后进入 Claiming", async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);
      expect(result).to.equal(true);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);

      expect(await contract.state()).to.equal(STATE_CLAIMING);
    });

    it("callbackFinalize(false) 后进入 Failed（终态）", async function () {
      // 故意配错 allocation，让 sumCheck 解出 false
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);
      expect(result).to.equal(false);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);

      expect(await contract.state()).to.equal(STATE_FAILED);
    });

    it("非 Setup 状态调用 finalize 应 revert", async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      // 现在是 Finalizing；再调一次 finalize 应 revert
      await expect(
        contract.connect(admin).finalize()
      ).to.be.revertedWithCustomError(contract, "NotSetup");
    });

    it("非 Finalizing 状态调用 callbackFinalize 应 revert（包括 Setup 阶段）", async function () {
      // Setup 阶段直接调 callbackFinalize 应 revert（即便携带签名也不行）
      await expect(
        contract.connect(admin).callbackFinalize(true, "0x")
      ).to.be.revertedWithCustomError(contract, "NotFinalizing");
    });

    it("callbackFinalize 重放应 revert", async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);

      // 重放：state 已是 Claiming，回放 revert
      await expect(
        contract.connect(admin).callbackFinalize(result, decryptionProof)
      ).to.be.revertedWithCustomError(contract, "NotFinalizing");
    });

    it("Finalizing 状态下 claim 应 revert（NotFinalized）", async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize(); // → Finalizing，未回调

      await expect(
        contract.connect(recipient1).claim()
      ).to.be.revertedWithCustomError(contract, "NotFinalized");
    });

    it("Failed 状态下 setAllocation 应 revert NotSetup", async function () {
      // 配错 allocation 让 callback 解出 false → Failed
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);
      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);

      const { handle: h3, proof: p3 } = await encryptAmount(contractAddress, admin.address, 100n);
      await expect(
        contract.connect(admin).setAllocation(other.address, h3, p3)
      ).to.be.revertedWithCustomError(contract, "NotSetup");
    });

    it("Failed 状态下 claim 应 revert（NotFailed）", async function () {
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);

      await expect(
        contract.connect(recipient1).claim()
      ).to.be.revertedWithCustomError(contract, "NotFailed");
    });

    it("finalized() 视图返回 state == Claiming（向后兼容）", async function () {
      expect(await contract.finalized()).to.equal(false);

      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(contractAddress, admin.address, ALLOC_2);
      await contract.connect(admin).setAllocation(recipient2.address, h2, p2);

      await contract.connect(admin).finalize();
      expect(await contract.finalized()).to.equal(false); // Finalizing → false

      const handle = await contract.finalizeCheckHandle();
      const { ebool: result, decryptionProof } = await publicDecryptWithProof(handle);
      await contract.connect(admin).callbackFinalize(result, decryptionProof);
      expect(await contract.finalized()).to.equal(true); // Claiming → true
    });
  });

  // ─────────────────────────────────────────────
  // V7: withdrawExcess
  // ─────────────────────────────────────────────
  describe("withdrawExcess", function () {
    // helper：deploy 一个超额注资的 campaign，并把它带到 Claiming 状态
    async function deployFundedAndClaim(extraFund: bigint) {
      const result = await deployCampaign({
        admin,
        auditor,
        recipients: [recipient1.address, recipient2.address],
        declaredTotal: DECLARED_TOTAL,
        tokenSupply: DECLARED_TOTAL + extraFund,
        fundEscrow: DECLARED_TOTAL + extraFund,
      });
      const { handle: h1, proof: p1 } = await encryptAmount(
        result.campaignAddress,
        admin.address,
        ALLOC_1
      );
      await result.campaign.connect(admin).setAllocation(recipient1.address, h1, p1);
      const { handle: h2, proof: p2 } = await encryptAmount(
        result.campaignAddress,
        admin.address,
        ALLOC_2
      );
      await result.campaign.connect(admin).setAllocation(recipient2.address, h2, p2);

      await result.campaign.connect(admin).finalize();
      const fhHandle = await result.campaign.finalizeCheckHandle();
      const { ebool: ok, decryptionProof } = await publicDecryptWithProof(fhHandle);
      await result.campaign.connect(admin).callbackFinalize(ok, decryptionProof);
      return result;
    }

    it("非 admin 调用应 revert NotAdmin", async function () {
      const { campaign } = await deployFundedAndClaim(500n);
      await expect(
        campaign.connect(other).withdrawExcess(1n)
      ).to.be.revertedWithCustomError(campaign, "NotAdmin");
    });

    it("无可取余额时 revert NoExcess", async function () {
      // balance == declaredTotal == stillOwed, 没有 excess
      const { campaign } = await deployFundedAndClaim(0n);
      await expect(
        campaign.connect(admin).withdrawExcess(1n)
      ).to.be.revertedWithCustomError(campaign, "NoExcess");
    });

    it("amount 超过 maxWithdraw 时 revert ExceedsExcess", async function () {
      // 多注资 500（balance=1500, stillOwed=1000, maxWithdraw=500）
      const { campaign } = await deployFundedAndClaim(500n);
      await expect(
        campaign.connect(admin).withdrawExcess(501n)
      ).to.be.revertedWithCustomError(campaign, "ExceedsExcess");
    });

    it("Admin 在可取范围内成功取走多余余额并 emit ExcessWithdrawn", async function () {
      const { campaign, campaignAddress, token: tk } = await deployFundedAndClaim(500n);

      const adminBalanceBefore = await tk.balanceOf(admin.address);
      await expect(campaign.connect(admin).withdrawExcess(500n))
        .to.emit(campaign, "ExcessWithdrawn")
        .withArgs(500n, 1000n);

      expect(await tk.balanceOf(admin.address)).to.equal(adminBalanceBefore + 500n);
      expect(await tk.balanceOf(campaignAddress)).to.equal(1000n);
    });

    it("claim 后 maxWithdraw 减少：claimed 部分计入 stillOwed 的减项", async function () {
      // balance=1500, declaredTotal=1000；recipient1 claim 600 后 claimedTotalPlaintext=600
      // stillOwed = 1000 - 600 = 400, maxWithdraw = 1500 - 600 (transferred) - 400 = 500
      const { campaign } = await deployFundedAndClaim(500n);

      // recipient1 claim + executeTransfer
      await campaign.connect(recipient1).claim();
      const pending = await campaign.pendingClaimHandle(recipient1.address);
      const { decryptionProof } = await publicDecryptWithProof(pending);
      await campaign.connect(other).executeTransfer(recipient1.address, ALLOC_1, decryptionProof);

      // balance now = 1500 - 600 = 900
      // stillOwed = 1000 - 600 = 400
      // maxWithdraw = 900 - 400 = 500
      // 取 500 应成功，取 501 应 revert
      await expect(
        campaign.connect(admin).withdrawExcess(501n)
      ).to.be.revertedWithCustomError(campaign, "ExceedsExcess");
      await expect(campaign.connect(admin).withdrawExcess(500n)).to.not.be.reverted;
    });

    it("非 Claiming 状态（Setup）下 withdrawExcess 应 revert NotClaiming", async function () {
      // 默认部署：state = Setup
      await expect(
        contract.connect(admin).withdrawExcess(1n)
      ).to.be.revertedWithCustomError(contract, "NotClaiming");
    });
  });

  // ─────────────────────────────────────────────
  // V7: cancelCampaign
  // ─────────────────────────────────────────────
  describe("cancelCampaign", function () {
    // helper：部署 + 设置错误总量的 allocation，让 callbackFinalize(false) 进入 Failed
    async function deployToFailed() {
      const result = await deployCampaign({
        admin,
        auditor,
        recipients: [recipient1.address, recipient2.address],
        declaredTotal: DECLARED_TOTAL,
      });
      const { handle: h1, proof: p1 } = await encryptAmount(
        result.campaignAddress,
        admin.address,
        ALLOC_1
      );
      await result.campaign.connect(admin).setAllocation(recipient1.address, h1, p1);
      // 故意错配
      const { handle: h2, proof: p2 } = await encryptAmount(
        result.campaignAddress,
        admin.address,
        ALLOC_1
      );
      await result.campaign.connect(admin).setAllocation(recipient2.address, h2, p2);

      await result.campaign.connect(admin).finalize();
      const fhHandle = await result.campaign.finalizeCheckHandle();
      const { ebool: ok, decryptionProof } = await publicDecryptWithProof(fhHandle);
      await result.campaign.connect(admin).callbackFinalize(ok, decryptionProof);
      return result;
    }

    it("非 admin 调用应 revert NotAdmin", async function () {
      const { campaign } = await deployToFailed();
      await expect(
        campaign.connect(other).cancelCampaign()
      ).to.be.revertedWithCustomError(campaign, "NotAdmin");
    });

    it("非 Failed 状态调用 应 revert NotFailed（Setup 状态）", async function () {
      // 默认 fixture state = Setup
      await expect(
        contract.connect(admin).cancelCampaign()
      ).to.be.revertedWithCustomError(contract, "NotFailed");
    });

    it("Failed 状态下 admin 取回全部余额并 emit CampaignCancelled", async function () {
      const { campaign, campaignAddress, token: tk } = await deployToFailed();
      const balance = await tk.balanceOf(campaignAddress);
      expect(balance).to.equal(DECLARED_TOTAL);

      const adminBefore = await tk.balanceOf(admin.address);
      await expect(campaign.connect(admin).cancelCampaign())
        .to.emit(campaign, "CampaignCancelled")
        .withArgs(balance);

      expect(await tk.balanceOf(campaignAddress)).to.equal(0n);
      expect(await tk.balanceOf(admin.address)).to.equal(adminBefore + balance);
    });

    it("重复调用：第二次 balance=0 仍 emit 0，不 revert（state 终态 Failed）", async function () {
      const { campaign } = await deployToFailed();
      await campaign.connect(admin).cancelCampaign();

      // 第二次调用：balance 已是 0，不再 safeTransfer，但仍 emit CampaignCancelled(0)
      await expect(campaign.connect(admin).cancelCampaign())
        .to.emit(campaign, "CampaignCancelled")
        .withArgs(0n);
    });
  });
});
