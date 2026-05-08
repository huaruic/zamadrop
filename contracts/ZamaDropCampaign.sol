// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ZamaDropCampaign
 * @notice 机密代币分发协议：allocation 金额加密存储，总量约束在密文状态下验证。
 *         "Private allocations. Public accountability."
 *
 * 状态机：Setup → Finalized → Claiming
 * - Setup: Admin 逐个设置加密 allocation，runningTotal 实时累加
 * - Finalized: FHE.eq(runningTotal, declaredTotal) 验证通过后进入
 * - Claiming: 受益人可 claim，Auditor 可查聚合统计
 */
contract ZamaDropCampaign is ZamaEthereumConfig {
    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────
    // 错误
    // ─────────────────────────────────────────────
    error NotAdmin();
    error NotAuditor();
    error NotFinalized();
    error AlreadyFinalized();
    error AllocationAlreadySet();
    error NoAllocation();
    error AlreadyClaimed();
    error NotClaimed();
    error AlreadyTransferred();
    error AmountMismatch();
    // bulk-allocation: arrays passed to setAllocationsBatch must agree.
    error ArrayLengthMismatch();
    // V7 invariants (constructor + state machine + escrow)
    error HashMismatch();
    error CountMismatch();
    error NotFunded();
    error NoExcess();
    error ExceedsExcess();
    // V7 explicit state machine
    error NotSetup();
    error NotFinalizing();
    error NotClaiming();
    error NotFailed();

    // ─────────────────────────────────────────────
    // 明文公开状态
    // ─────────────────────────────────────────────
    uint64 public immutable declaredTotal;
    uint64 public immutable recipientCount;
    address public immutable admin;
    address public immutable auditor;
    IERC20 public immutable token;
    bytes32 public immutable recipientListHash;

    // V7: explicit lifecycle state machine.
    //   Setup       — admin populating allocations
    //   Finalizing  — finalize() requested KMS publicDecrypt; awaiting callbackFinalize
    //   Claiming    — KMS confirmed the total; recipients may claim
    //   Failed      — terminal; KMS reported sum mismatch. Recovery via cancelCampaign.
    enum State { Setup, Finalizing, Claiming, Failed }
    State public state;

    // V7: tracks how many distinct setAllocation calls succeeded; used by finalize
    // to require allocationCount == recipientCount before the FHE total check runs.
    uint64 public allocationCount;

    // V7: plaintext sum of every successful executeTransfer. Supports the public
    // solvency invariant `balanceOf(this) >= declaredTotal - claimedTotalPlaintext`.
    uint64 public claimedTotalPlaintext;

    mapping(address => bool) public allocationSet;
    mapping(address => bool) public claimed;
    mapping(address => bytes32) public pendingClaimHandle;
    mapping(address => bool) public transferred;

    // finalize 产生的 ebool 密文 handle，供链下 publicDecrypt 使用
    bytes32 public finalizeCheckHandle;

    // ─────────────────────────────────────────────
    // 加密状态
    // ─────────────────────────────────────────────
    mapping(address => euint64) private _allocation;
    euint64 private _runningTotal;
    euint64 private _claimedTotal;

    // ─────────────────────────────────────────────
    // 事件
    // ─────────────────────────────────────────────
    event AllocationSet(address indexed recipient);
    event FinalizeRequested(bytes32 checkHandle);
    event Finalized(bool success);
    event Claimed(address indexed recipient);
    event ClaimRequested(address indexed user, bytes32 handle);
    event TokenTransferred(address indexed user, uint64 amount);
    event ExcessWithdrawn(uint256 amount, uint256 remainingBalance);
    event CampaignCancelled(uint256 returnedAmount);

    // ─────────────────────────────────────────────
    // 构造函数
    // ─────────────────────────────────────────────
    /**
     * @notice V7 constructor: explicit admin (so Safe/AA wallets work) and a
     *         keccak256 commitment to the recipient list. The list itself is
     *         NOT persisted — only its hash + length — so on-chain footprint
     *         stays tiny while auditors can later replay AllocationSet events
     *         and recompute the same hash.
     */
    constructor(
        address admin_,
        address auditor_,
        address token_,
        uint64 declaredTotal_,
        address[] memory recipients,
        bytes32 listHash_
    ) {
        if (keccak256(abi.encode(recipients)) != listHash_) revert HashMismatch();

        declaredTotal = declaredTotal_;
        recipientCount = uint64(recipients.length);
        admin = admin_;
        auditor = auditor_;
        token = IERC20(token_);
        recipientListHash = listHash_;

        // 初始化加密零值
        _runningTotal = FHE.asEuint64(0);
        FHE.allowThis(_runningTotal);

        _claimedTotal = FHE.asEuint64(0);
        FHE.allowThis(_claimedTotal);
        FHE.allow(_claimedTotal, auditor_);
    }

    // ─────────────────────────────────────────────
    // Admin：设置 allocation
    // ─────────────────────────────────────────────
    /**
     * @notice Admin 为单个受益人设置加密 allocation。
     *         每次调用都把金额累加到 runningTotal——增量模式，不在 finalize 时循环。
     * @param recipient 受益人地址
     * @param encAmount 来自客户端 fhevmjs 加密的 externalEuint64
     * @param inputProof 加密证明（由 fhevmjs 一同返回）
     */
    function setAllocation(
        address recipient,
        externalEuint64 encAmount,
        bytes calldata inputProof
    ) external {
        if (msg.sender != admin) revert NotAdmin();
        // V7: Setup is the only state where new allocations may be added.
        // Keep the legacy AlreadyFinalized error for the common Setup→Finalizing
        // case to preserve client-facing semantics; other states fall through to
        // the dedicated revert.
        if (state == State.Finalizing || state == State.Claiming) revert AlreadyFinalized();
        if (state != State.Setup) revert NotSetup();
        if (allocationSet[recipient]) revert AllocationAlreadySet();

        // 从客户端密文转为链上 euint64，验证 inputProof
        euint64 amount = FHE.fromExternal(encAmount, inputProof);

        // 存储 allocation，仅允许受益人和合约自身访问
        _allocation[recipient] = amount;
        FHE.allowThis(_allocation[recipient]);
        FHE.allow(_allocation[recipient], recipient);

        // 增量累加到 runningTotal
        _runningTotal = FHE.add(_runningTotal, amount);
        FHE.allowThis(_runningTotal);

        allocationSet[recipient] = true;
        // V7: bump after the dedupe flag so a revert above does not increment.
        allocationCount += 1;
        emit AllocationSet(recipient);
    }

    /**
     * @notice Admin 批量为多个受益人设置加密 allocation。同一个 inputProof
     *         覆盖批内所有 amounts（relayer SDK 把 N 个 add64 调用打到一个
     *         proof 里）。每个 recipient 的处理与 setAllocation 完全等价：
     *         dedupe → fromExternal → store → ACL → runningTotal 累加 → emit。
     *
     *         批内任一 recipient 已被 set 或 array 长度对不上，整笔交易
     *         revert（atomic 语义，避免 partial state）。
     *
     *         批的实际上限由两条协议层约束决定，**不是合约层守卫**：
     *           1. Zama relayer SDK packing limit：单个 proof 最多 32 个
     *              uint64 amounts（2048 bits / 64 bits），客户端
     *              `createEncryptedInput().add64(...).encrypt()` 在第 33
     *              个 add64 时抛错
     *           2. 区块 gas 上限：每个 FHE.fromExternal verify ~500k gas，
     *              单批 32 个 ≈ 16M gas（Sepolia 30M block 53% 占用）
     *
     *         合约本身可接受任意长度 array；调用端负责切片到 ≤ 32。
     *
     * @param recipients   批内每个受益人地址（顺序与 encAmounts 对齐）
     * @param encAmounts   来自客户端 fhevmjs 同一次 createEncryptedInput
     *                     生成的多个 externalEuint64 handles
     * @param inputProof   覆盖整批 amounts 的 KMS-verified proof（共享）
     */
    function setAllocationsBatch(
        address[] calldata recipients,
        externalEuint64[] calldata encAmounts,
        bytes calldata inputProof
    ) external {
        if (msg.sender != admin) revert NotAdmin();
        if (state == State.Finalizing || state == State.Claiming) revert AlreadyFinalized();
        if (state != State.Setup) revert NotSetup();
        if (recipients.length != encAmounts.length) revert ArrayLengthMismatch();

        for (uint256 i = 0; i < recipients.length; i++) {
            address recipient = recipients[i];
            if (allocationSet[recipient]) revert AllocationAlreadySet();

            // 同一个 inputProof verify 第 i 个 handle。relayer SDK 把整批
            // amounts 打到这一个 proof 里，每次 fromExternal 校验对应 handle
            // 即可，无需多份 proof。
            euint64 amount = FHE.fromExternal(encAmounts[i], inputProof);

            _allocation[recipient] = amount;
            FHE.allowThis(_allocation[recipient]);
            FHE.allow(_allocation[recipient], recipient);

            _runningTotal = FHE.add(_runningTotal, amount);
            FHE.allowThis(_runningTotal);

            allocationSet[recipient] = true;
            allocationCount += 1;
            emit AllocationSet(recipient);
        }
    }

    // ─────────────────────────────────────────────
    // Admin：触发总量验证
    // ─────────────────────────────────────────────
    /**
     * @notice Admin 触发 FHE 总量等式验证。
     *         计算 runningTotal == declaredTotal（在密文状态下），
     *         将 ebool handle 暴露给链下公开解密，然后调用 callbackFinalize。
     */
    function finalize() external {
        if (msg.sender != admin) revert NotAdmin();
        // V7: finalize is only valid in Setup. Re-finalize attempts and
        // post-callback calls land here.
        if (state != State.Setup) revert NotSetup();
        // V7: every recipient slot must have an allocation before we run the
        // FHE total check. Without this, an admin could finalize with N-1
        // allocations whose sum coincidentally matches declaredTotal.
        if (allocationCount != recipientCount) revert CountMismatch();
        // V7: escrow must already cover declaredTotal. Catches the silent
        // failure where claim() succeeds but executeTransfer reverts later.
        if (token.balanceOf(address(this)) < declaredTotal) revert NotFunded();

        // 在密文状态下验证：runningTotal == declaredTotal
        euint64 encDeclared = FHE.asEuint64(declaredTotal);
        ebool sumCheck = FHE.eq(_runningTotal, encDeclared);

        // 标记为公开可解密，任何人可拿 handle 去 Gateway 解密
        sumCheck = FHE.makePubliclyDecryptable(sumCheck);
        finalizeCheckHandle = bytes32(ebool.unwrap(sumCheck));
        // V7: enter Finalizing only after all preconditions pass.
        state = State.Finalizing;
        emit FinalizeRequested(finalizeCheckHandle);
    }

    /**
     * @notice 接收 KMS-signed publicDecrypt 结果，翻转 finalized 标志。
     *         任何人可调用 —— 信任根是 Zama threshold KMS 的签名，不是 caller 身份。
     *         详见 docs/security-notes.md §4。
     * @param result          publicDecrypt 返回的 bool（true = 总量一致，可进入领取阶段）
     * @param decryptionProof KMS threshold 签名的 proof（PublicDecryptResults.decryptionProof）
     */
    function callbackFinalize(bool result, bytes calldata decryptionProof) external {
        // V7: the KMS callback is only valid in Finalizing. Replays land here.
        if (state != State.Finalizing) revert NotFinalizing();

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = finalizeCheckHandle;
        FHE.checkSignatures(handles, abi.encode(result), decryptionProof);

        state = result ? State.Claiming : State.Failed;
        emit Finalized(result);
    }

    // ─────────────────────────────────────────────
    // 受益人：查看自己的 allocation
    // ─────────────────────────────────────────────
    /**
     * @notice Backward-compatible boolean view of the new state machine.
     *         Returns true iff KMS confirmed the total (state == Claiming).
     *         Existing clients that read `.finalized()` continue to work.
     */
    function finalized() external view returns (bool) {
        return state == State.Claiming;
    }

    /**
     * @notice 受益人调用此函数，返回自己 allocation 的密文 handle（bytes32）。
     *         前端用 fhevmjs 的 user re-encryption 在浏览器端解密，服务器不经手明文。
     */
    function requestMyAllocation() external view returns (bytes32) {
        if (!allocationSet[msg.sender]) revert NoAllocation();
        return bytes32(euint64.unwrap(_allocation[msg.sender]));
    }

    // ─────────────────────────────────────────────
    // 受益人：领取
    // ─────────────────────────────────────────────
    /**
     * @notice 受益人领取自己的 allocation。
     *         操作顺序：check → set claimed → FHE.add(claimedTotal) → transfer
     *         整体原子性，任何步骤失败则整笔交易 revert。
     */
    function claim() external {
        // V7: claim only works after KMS confirmed the total (Claiming).
        // We keep the legacy NotFinalized error for the Setup/Finalizing
        // path so existing client code that handles "not finalized yet"
        // does not break; Failed gets its own dedicated revert.
        if (state == State.Failed) revert NotFailed();
        if (state != State.Claiming) revert NotFinalized();
        if (!allocationSet[msg.sender]) revert NoAllocation();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        // check-then-set 防双花
        claimed[msg.sender] = true;

        // 更新 claimedTotal（仅此处累加，不在其他地方更新）
        _claimedTotal = FHE.add(_claimedTotal, _allocation[msg.sender]);
        FHE.allowThis(_claimedTotal);
        FHE.allow(_claimedTotal, auditor);

        emit Claimed(msg.sender);

        // 标记该用户 allocation 为公开可解密，链下 oracle 解密后调用 executeTransfer
        _allocation[msg.sender] = FHE.makePubliclyDecryptable(_allocation[msg.sender]);
        pendingClaimHandle[msg.sender] = bytes32(euint64.unwrap(_allocation[msg.sender]));
        emit ClaimRequested(msg.sender, pendingClaimHandle[msg.sender]);
    }

    // ─────────────────────────────────────────────
    // 链下 oracle：执行 token 转账
    // ─────────────────────────────────────────────
    /**
     * @notice 链下 executor 公开解密 pendingClaimHandle[user] 后调用此函数完成转账。
     *         任何人可调用 —— 信任根是 Zama threshold KMS 的签名，不是 caller 身份。
     *         FHE.checkSignatures revert 时整笔交易回滚，amount 必须与 handle 解密结果一致。
     *         详见 docs/security-notes.md §4。
     * @param user             受益人地址（claim 完毕等待转账的）
     * @param amount           解密后的 allocation 金额
     * @param decryptionProof  KMS threshold 签名的 proof（PublicDecryptResults.decryptionProof）
     */
    function executeTransfer(address user, uint64 amount, bytes calldata decryptionProof) external {
        if (!claimed[user]) revert NotClaimed();
        if (transferred[user]) revert AlreadyTransferred();

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = pendingClaimHandle[user];
        FHE.checkSignatures(handles, abi.encode(amount), decryptionProof);

        transferred[user] = true;
        // V7: plaintext accumulator drives the public solvency invariant.
        // Bumped before the transfer so a transfer revert unwinds the bump.
        claimedTotalPlaintext += amount;
        token.safeTransfer(user, amount);
        emit TokenTransferred(user, amount);
    }

    // ─────────────────────────────────────────────
    // Auditor：查看聚合统计
    // ─────────────────────────────────────────────
    /**
     * @notice Auditor 调用此函数，返回 claimedTotal 的密文 handle。
     *         Auditor 用 user re-encryption 解密聚合值（无法看到任何个人金额）。
     */
    function requestClaimedTotalForAuditor() external view returns (bytes32) {
        if (msg.sender != auditor) revert NotAuditor();
        return bytes32(euint64.unwrap(_claimedTotal));
    }

    // ─────────────────────────────────────────────
    // V7: 资金回收
    // ─────────────────────────────────────────────
    /**
     * @notice Admin withdraws ZDT in excess of what's still owed to recipients.
     *         The math `maxWithdraw = balance - (declaredTotal - claimedTotalPlaintext)`
     *         protects unclaimed allocations: even if every remaining recipient
     *         claims afterwards, the contract still has enough to pay them.
     *
     *         Restricted to Claiming state. In Failed state the math collapses
     *         (claimedTotalPlaintext == 0 ⇒ maxWithdraw = 0); use cancelCampaign
     *         for that recovery path instead.
     */
    function withdrawExcess(uint256 amount) external {
        if (msg.sender != admin) revert NotAdmin();
        if (state != State.Claiming) revert NotClaiming();

        uint256 stillOwed = uint256(declaredTotal) - uint256(claimedTotalPlaintext);
        uint256 balance = token.balanceOf(address(this));
        if (balance <= stillOwed) revert NoExcess();

        uint256 maxWithdraw = balance - stillOwed;
        if (amount > maxWithdraw) revert ExceedsExcess();

        token.safeTransfer(admin, amount);
        emit ExcessWithdrawn(amount, balance - amount);
    }

    /**
     * @notice Failure-path recovery. Only callable in the Failed terminal state.
     *         Returns the contract's entire token balance to admin so a fresh
     *         campaign can be deployed with corrected inputs. Failed implies
     *         callbackFinalize(true) never fired, so no recipient could claim
     *         and there is no obligation to honor.
     */
    function cancelCampaign() external {
        if (msg.sender != admin) revert NotAdmin();
        if (state != State.Failed) revert NotFailed();

        uint256 balance = token.balanceOf(address(this));
        if (balance > 0) {
            token.safeTransfer(admin, balance);
        }
        emit CampaignCancelled(balance);
    }
}
