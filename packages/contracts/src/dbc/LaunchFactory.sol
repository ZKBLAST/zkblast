// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ProtocolAccess } from "../access/ProtocolAccess.sol";
import { TokenTransfer } from "../libraries/TokenTransfer.sol";
import { UUPSUpgradeable } from "../proxy/UUPSUpgradeable.sol";
import { IDbcEvents } from "./IDbcEvents.sol";
import { LaunchConfigRegistry } from "./LaunchConfigRegistry.sol";
import { LaunchToken } from "./LaunchToken.sol";
import { LaunchTokenDeployer } from "./LaunchTokenDeployer.sol";
import { VirtualPool } from "./VirtualPool.sol";
import { VirtualPoolDeployer } from "./VirtualPoolDeployer.sol";

contract LaunchFactory is ProtocolAccess, UUPSUpgradeable, IDbcEvents {
    using TokenTransfer for address;

    error InvalidLaunch();
    error LaunchAlreadyExists();
    error TemplateUnavailable();

    bytes32 public constant LAUNCHPAD_FACTORY_ROLE =
        keccak256("ZKBLAST_DBC_LAUNCHPAD_FACTORY_ROLE");

    struct LaunchRequest {
        uint256 templateId;
        bytes32 salt;
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
    }

    LaunchConfigRegistry public registry;
    LaunchTokenDeployer public tokenDeployer;
    VirtualPoolDeployer public poolDeployer;
    address public graduationManager;
    uint256 public launchCount;
    mapping(bytes32 launchId => LaunchRecord record) public launches;
    mapping(address token => bytes32 launchId) public launchByToken;
    mapping(address pool => bytes32 launchId) public launchByPool;

    event VirtualPoolDeployerUpdated(address indexed previousDeployer, address indexed deployer);

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address admin,
        address upgrader,
        LaunchConfigRegistry registry_,
        LaunchTokenDeployer tokenDeployer_,
        VirtualPoolDeployer poolDeployer_
    ) external initializer {
        if (
            address(registry_) == address(0) || address(tokenDeployer_).code.length == 0
                || address(poolDeployer_).code.length == 0
        ) revert InvalidLaunch();
        __ProtocolAccess_init(admin, upgrader);
        registry = registry_;
        tokenDeployer = tokenDeployer_;
        poolDeployer = poolDeployer_;
    }

    function launchIdentifier(address creator, uint256 templateId, bytes32 salt)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), creator, templateId, salt));
    }

    function createLaunch(LaunchRequest calldata request)
        external
        returns (bytes32 launchId, address token, address virtualPool)
    {
        return _createLaunch(request, msg.sender, address(0));
    }

    function createLaunchFor(
        LaunchRequest calldata request,
        address creator,
        address feeCollector
    )
        external
        onlyRole(LAUNCHPAD_FACTORY_ROLE)
        returns (bytes32 launchId, address token, address virtualPool)
    {
        if (creator == address(0) || feeCollector == address(0)) revert InvalidLaunch();
        return _createLaunch(request, creator, feeCollector);
    }

    /// @notice Rotates the non-upgradeable CREATE2 deployer after it has been
    ///         bound to this factory. Existing launches remain untouched.
    function setPoolDeployer(VirtualPoolDeployer deployer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(deployer).code.length == 0 || deployer.factory() != address(this)) {
            revert InvalidLaunch();
        }
        address previous = address(poolDeployer);
        poolDeployer = deployer;
        emit VirtualPoolDeployerUpdated(previous, address(deployer));
    }

    function _createLaunch(
        LaunchRequest calldata request,
        address creator,
        address feeCollector
    )
        private
        returns (bytes32 launchId, address token, address virtualPool)
    {
        if (
            request.salt == bytes32(0) || bytes(request.name).length == 0
                || bytes(request.symbol).length == 0 || request.creatorTokenRecipient == address(0)
        ) revert InvalidLaunch();
        LaunchConfigRegistry.TemplateRecord memory template = registry.template(request.templateId);
        if (!template.enabled) revert TemplateUnavailable();
        launchId = launchIdentifier(creator, request.templateId, request.salt);
        if (launches[launchId].creator != address(0)) revert LaunchAlreadyExists();

        LaunchToken launchToken = tokenDeployer.deploy(
            keccak256(abi.encode(launchId, "TOKEN")),
            request.name,
            request.symbol,
            request.metadataURI,
            template.config.totalSupplyRaw,
            address(this)
        );
        token = address(launchToken);
        VirtualPool pool = feeCollector == address(0)
            ? poolDeployer.deploy(
                keccak256(abi.encode(launchId, "VIRTUAL_POOL")),
                launchId,
                request.templateId,
                creator,
                token,
                template.config
            )
            : poolDeployer.deployForLaunchpad(
                keccak256(abi.encode(launchId, "VIRTUAL_POOL")),
                launchId,
                request.templateId,
                creator,
                token,
                template.config,
                feeCollector
            );
        virtualPool = address(pool);

        if (graduationManager != address(0)) pool.setGraduationManager(graduationManager);

        token.pushExact(virtualPool, template.config.baseInventoryRaw);
        uint256 creatorAmount = template.config.totalSupplyRaw - template.config.baseInventoryRaw;
        if (creatorAmount != 0) token.pushExact(request.creatorTokenRecipient, creatorAmount);
        pool.activate();
        registry.markTemplateUsed(request.templateId);

        launches[launchId] = LaunchRecord(creator, token, virtualPool, request.templateId);
        launchByToken[token] = launchId;
        launchByPool[virtualPool] = launchId;
        ++launchCount;
        emit TokenLaunched(
            launchId,
            request.templateId,
            creator,
            token,
            virtualPool,
            template.config.quoteToken,
            template.config.baseInventoryRaw,
            template.config.graduationThresholdRaw
        );
        _emitLaunchMetadata(launchId, request);
    }

    function _emitLaunchMetadata(bytes32 launchId, LaunchRequest calldata request) private {
        emit LaunchMetadataPublished(
            launchId,
            request.name,
            request.symbol,
            request.metadataURI,
            request.creatorTokenRecipient
        );
    }

    function setPoolPaused(VirtualPool pool, bool paused) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (launchByPool[address(pool)] == bytes32(0)) revert InvalidLaunch();
        pool.setPaused(paused);
    }

    function setGraduationManager(address manager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (manager == address(0)) revert InvalidLaunch();
        graduationManager = manager;
    }

    function configurePoolGraduationManager(VirtualPool pool, address manager)
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
