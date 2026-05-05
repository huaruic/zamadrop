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
  const RECIPIENT_COUNT = 2n;
  const ALLOC_1 = 600n;
  const ALLOC_2 = 400n; // 总和 = 1000 = DECLARED_TOTAL

  beforeEach(async function () {
    [admin, recipient1, recipient2, auditor, other] = await ethers.getSigners();

    // 部署 MockToken（admin 持有 declaredTotal）
    const TokenFactory = await ethers.getContractFactory("MockToken");
    const token = await TokenFactory.connect(admin).deploy(
      "ZamaDrop Test Token",
      "ZDT",
      DECLARED_TOTAL,
      admin.address
    );
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    const Factory = await ethers.getContractFactory("ZamaDropCampaign");
    const deployed = await Factory.connect(admin).deploy(
      DECLARED_TOTAL,
      RECIPIENT_COUNT,
      auditor.address,
      tokenAddress
    );
    await deployed.waitForDeployment();
    contractAddress = await deployed.getAddress();
    contract = await ethers.getContractAt("ZamaDropCampaign", contractAddress);
    tokenContract = await ethers.getContractAt("MockToken", tokenAddress);

    // 把 escrow 转入 campaign 合约（让 executeTransfer 时有钱可转）
    await token.connect(admin).transfer(contractAddress, DECLARED_TOTAL);
  });

  // ─────────────────────────────────────────────
  // 部署和初始状态
  // ─────────────────────────────────────────────
  describe("部署初始状态", function () {
    it("应正确设置 declaredTotal、recipientCount、admin、auditor", async function () {
      expect(await contract.declaredTotal()).to.equal(DECLARED_TOTAL);
      expect(await contract.recipientCount()).to.equal(RECIPIENT_COUNT);
      expect(await contract.admin()).to.equal(admin.address);
      expect(await contract.auditor()).to.equal(auditor.address);
      expect(await contract.finalized()).to.equal(false);
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
      // 故意只设置一个，总量不足
      const { handle: h1, proof: p1 } = await encryptAmount(contractAddress, admin.address, ALLOC_1);
      await contract.connect(admin).setAllocation(recipient1.address, h1, p1);

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
      // 重新部署一个未 finalize 的合约（同时部署一个 fresh token）
      const TokenFactory = await ethers.getContractFactory("MockToken");
      const freshToken = await TokenFactory.connect(admin).deploy(
        "ZamaDrop Test Token",
        "ZDT",
        DECLARED_TOTAL,
        admin.address
      );
      await freshToken.waitForDeployment();
      const Factory = await ethers.getContractFactory("ZamaDropCampaign");
      const fresh = await Factory.connect(admin).deploy(
        DECLARED_TOTAL,
        RECIPIENT_COUNT,
        auditor.address,
        await freshToken.getAddress()
      );
      await fresh.waitForDeployment();
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
  });
});
