// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { ProtocolAccess } from "../../access/ProtocolAccess.sol";
import { DbcTypes } from "../../dbc/DbcTypes.sol";
import { LaunchConfigRegistry } from "../../dbc/LaunchConfigRegistry.sol";
import { ProtectedVirtualPool } from "../../dbc/ProtectedVirtualPool.sol";
import { TokenTransfer } from "../../libraries/TokenTransfer.sol";
import { UUPSUpgradeable } from "../../proxy/UUPSUpgradeable.sol";
import { LaunchProtectionPolicyRegistry } from "./LaunchProtectionPolicyRegistry.sol";
import { ProtectedLaunchToken } from "./ProtectedLaunchToken.sol";
import { ProtectedLaunchTokenDeployer } from "./ProtectedLaunchTokenDeployer.sol";
import { ProtectedLaunchIdentityRegistry } from "./ProtectedLaunchIdentityRegistry.sol";
import { ProtectedVirtualPoolDeployer } from "./ProtectedVirtualPoolDeployer.sol";

/// @notice Isolated factory for Protected launches. Existing Standard factories remain unchanged.
contract ProtectedLaunchFactory is ProtocolAccess, UUPSUpgradeable {
    using TokenTransfer for address;

    error InvalidLaunch();
    error LaunchAlreadyExists();
    error PolicyUnavailable();
    error TemplateUnavailable();

    bytes32 public constant LAUNCHPAD_FACTORY_ROLE =
        keccak256("ZKBLAST_PROTECTED_LAUNCHPAD_FACTORY_ROLE");
    uint8 public constant LAUNCH_MODE_PROTECTED = 1;

    struct LaunchRequest {
        uint256 templateId;
        uint256 policyId;
        bytes32 salt;
        uint64 deadline;
        string name;
        string symbol;
        string metadataURI;
        address creatorTokenRecipient;
    }

    struct LaunchRecord {
        address creator;
        address token;
        address virtualPool;
        uint256 templateId;
        uint256 policyId;
        bytes32 policyHash;
        uint64 protectionStartBlock;
    }

    LaunchConfigRegistry public templateRegistry;
    LaunchProtectionPolicyRegistry public policyRegistry;
    ProtectedLaunchTokenDeployer public tokenDeployer;
    ProtectedVirtualPoolDeployer public poolDeployer;
    address public graduationManager;
    uint256 public launchCount;
    ProtectedLaunchIdentityRegistry public identityRegistry;
    mapping(bytes32 launchId => LaunchRecord record) public launches;
    mapping(address token => bytes32 launchId) public launchByToken;
    mapping(address pool => bytes32 launchId) public launchByPool;

    event ProtectedTokenLaunched(
        bytes32 indexed launchId,
        uint256 indexed templateId,
        uint256 indexed policyId,
        bytes32 policyHash,
        address creator,
        address token,
        address virtualPool,
        address quoteToken,
        uint64 protectionStartBlock
    );
    event ProtectedLaunchMetadataPublished(
        bytes32 indexed launchId,
        string name,
        string symbol,
        string metadataURI,
        address creatorTokenRecipient
    );

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address upgrader,
        LaunchConfigRegistry templateRegistry_,
        LaunchProtectionPolicyRegistry policyRegistry_,
        ProtectedLaunchTokenDeployer tokenDeployer_,
        ProtectedVirtualPoolDeployer poolDeployer_,
        ProtectedLaunchIdentityRegistry identityRegistry_
    ) external initializer {
        if (
            address(templateRegistry_).code.length == 0 || address(policyRegistry_).code.length == 0
                || address(tokenDeployer_).code.length == 0
                || address(poolDeployer_).code.length == 0
                || address(identityRegistry_).code.length == 0
        ) revert InvalidLaunch();
        __ProtocolAccess_init(admin, upgrader);
        templateRegistry = templateRegistry_;
        policyRegistry = policyRegistry_;
        tokenDeployer = tokenDeployer_;
        poolDeployer = poolDeployer_;
        identityRegistry = identityRegistry_;
    }

    function launchIdentifier(address creator, uint256 templateId, uint256 policyId, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return
            keccak256(abi.encode(block.chainid, address(this), creator, templateId, policyId, salt));
    }

    function createLaunch(LaunchRequest calldata request)
        external
        returns (bytes32 launchId, address token, address virtualPool)
    {
        return _createLaunch(request, msg.sender, address(0));
    }

    function createLaunchFor(LaunchRequest calldata request, address creator, address feeCollector)
        external
        onlyRole(LAUNCHPAD_FACTORY_ROLE)
        returns (bytes32 launchId, address token, address virtualPool)
    {
        if (creator == address(0) || feeCollector == address(0)) revert InvalidLaunch();
        return _createLaunch(request, creator, feeCollector);
    }

    function _createLaunch(LaunchRequest calldata request, address creator, address feeCollector)
        private
        returns (bytes32 launchId, address token, address virtualPool)
    {
        if (
            request.salt == bytes32(0) || bytes(request.name).length == 0
                || bytes(request.symbol).length == 0 || request.creatorTokenRecipient == address(0)
                || request.deadline < block.timestamp
        ) revert InvalidLaunch();

        LaunchConfigRegistry.TemplateRecord memory template =
            templateRegistry.template(request.templateId);
        if (!template.enabled) revert TemplateUnavailable();
        LaunchProtectionPolicyRegistry.Policy memory policy =
            policyRegistry.policy(request.policyId);
        if (
            !policy.enabled || policy.batchMode
                || policy.baseFeeBps != template.config.fees.tradeFeeBps
        ) revert PolicyUnavailable();

        launchId = launchIdentifier(creator, request.templateId, request.policyId, request.salt);
        if (launches[launchId].creator != address(0)) revert LaunchAlreadyExists();

        ProtectedLaunchToken launchToken = tokenDeployer.deploy(
            keccak256(abi.encode(launchId, "PROTECTED_TOKEN")),
            request.name,
            request.symbol,
            request.metadataURI,
            template.config.totalSupplyRaw,
            launchId,
            request.policyId,
            policy.policyHash,
            policy.protectionBlocks,
            policy.maxBuyBpsPerTransaction,
            policy.maxBuyBpsPerAddress
        );
        token = address(launchToken);
        uint64 startBlock = uint64(block.number);
        ProtectedVirtualPool pool = poolDeployer.deploy(
            keccak256(abi.encode(launchId, "PROTECTED_POOL")),
            launchId,
            request.templateId,
            creator,
            token,
            template.config,
            feeCollector,
            policy.policyHash,
            startBlock,
            policy.protectionBlocks,
            policy.initialFeeBps,
            policy.baseFeeBps
        );
        virtualPool = address(pool);

        if (graduationManager != address(0)) pool.setGraduationManager(graduationManager);
        token.pushExact(virtualPool, template.config.baseInventoryRaw);
        uint256 creatorAmount = template.config.totalSupplyRaw - template.config.baseInventoryRaw;
        if (creatorAmount != 0) token.pushExact(request.creatorTokenRecipient, creatorAmount);

        launchToken.bindProtectedPool(virtualPool, startBlock);
        pool.activate();
        templateRegistry.markTemplateUsed(request.templateId);
        policyRegistry.markPolicyUsed(request.policyId);

        launches[launchId] = LaunchRecord({
            creator: creator,
            token: token,
            virtualPool: virtualPool,
            templateId: request.templateId,
            policyId: request.policyId,
            policyHash: policy.policyHash,
            protectionStartBlock: startBlock
        });
        launchByToken[token] = launchId;
        launchByPool[virtualPool] = launchId;
        ++launchCount;

        identityRegistry.registerIdentity(
            ProtectedLaunchIdentityRegistry.IdentityInput({
                launchId: launchId,
                factory: address(this),
                token: token,
                pool: virtualPool,
                launchpadId: 0,
                name: request.name,
                symbol: request.symbol,
                metadataHash: keccak256(bytes(request.metadataURI)),
                socialHash: bytes32(0),
                tokenTemplateVersion: launchToken.TEMPLATE_VERSION()
            })
        );

        emit ProtectedTokenLaunched(
            launchId,
            request.templateId,
            request.policyId,
            policy.policyHash,
            creator,
            token,
            virtualPool,
            template.config.quoteToken,
            startBlock
        );
        emit ProtectedLaunchMetadataPublished(
            launchId,
            request.name,
            request.symbol,
            request.metadataURI,
            request.creatorTokenRecipient
        );
    }

    function setPoolPaused(ProtectedVirtualPool pool, bool paused)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (launchByPool[address(pool)] == bytes32(0)) revert InvalidLaunch();
        pool.setPaused(paused);
    }

    function setGraduationManager(address manager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (manager == address(0)) revert InvalidLaunch();
        graduationManager = manager;
    }

    function configurePoolGraduationManager(ProtectedVirtualPool pool, address manager)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (launchByPool[address(pool)] == bytes32(0) || manager == address(0)) {
            revert InvalidLaunch();
        }
        pool.setGraduationManager(manager);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) { }
}
