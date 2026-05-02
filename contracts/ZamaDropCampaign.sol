// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

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

    // ─────────────────────────────────────────────
    // 明文公开状态
    // ─────────────────────────────────────────────
    uint64 public immutable declaredTotal;
    uint64 public immutable recipientCount;
    address public immutable admin;
    address public immutable auditor;
    IERC20 public immutable token;

    bool public finalized;

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

    // ─────────────────────────────────────────────
    // 构造函数
    // ─────────────────────────────────────────────
    constructor(uint64 _declaredTotal, uint64 _recipientCount, address _auditor, address _token) {
        declaredTotal = _declaredTotal;
        recipientCount = _recipientCount;
        admin = msg.sender;
        auditor = _auditor;
        token = IERC20(_token);

        // 初始化加密零值
        _runningTotal = FHE.asEuint64(0);
        FHE.allowThis(_runningTotal);

        _claimedTotal = FHE.asEuint64(0);
        FHE.allowThis(_claimedTotal);
        FHE.allow(_claimedTotal, _auditor);
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
        if (finalized) revert AlreadyFinalized();
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
        emit AllocationSet(recipient);
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

        // 在密文状态下验证：runningTotal == declaredTotal
        euint64 encDeclared = FHE.asEuint64(declaredTotal);
        ebool sumCheck = FHE.eq(_runningTotal, encDeclared);

        // 标记为公开可解密，任何人可拿 handle 去 Gateway 解密
        sumCheck = FHE.makePubliclyDecryptable(sumCheck);
        finalizeCheckHandle = bytes32(ebool.unwrap(sumCheck));
        emit FinalizeRequested(finalizeCheckHandle);
    }

    /**
     * @notice 接收链下 publicDecrypt 的结果，翻转 finalized 标志。
     *         在真实 Testnet 上，此函数应验证 KMS 签名；MVP 阶段接受任何调用者。
     * @param result publicDecrypt 返回的 bool（true = 总量一致，可进入领取阶段）
     */
    function callbackFinalize(bool result) external {
        finalized = result;
        emit Finalized(result);
    }

    // ─────────────────────────────────────────────
    // 受益人：查看自己的 allocation
    // ─────────────────────────────────────────────
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
        if (!finalized) revert NotFinalized();
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
     * @notice 链下 oracle 公开解密 pendingClaimHandle[user] 后调用此函数完成转账。
     *         MVP 阶段：任何人可调用（信任链下 publicDecrypt 的诚实性）。
     *         生产环境：应验证 KMS 签名 + amount 与 handle 解密结果一致。
     */
    function executeTransfer(address user, uint64 amount) external {
        if (!claimed[user]) revert NotClaimed();
        if (transferred[user]) revert AlreadyTransferred();
        transferred[user] = true;
        require(token.transfer(user, amount), "token transfer failed");
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
}
