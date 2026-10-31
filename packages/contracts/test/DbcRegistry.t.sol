// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { LaunchConfigRegistry } from "../src/dbc/LaunchConfigRegistry.sol";
import { DbcTypes } from "../src/dbc/DbcTypes.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

contract MockUsdgMetadata {
    string public constant name = "Global Dollar";
    string public constant symbol = "USDG";
    uint8 public constant decimals = 6;
}

contract UnauthorizedTemplateCaller {
    function setQuoteToken(LaunchConfigRegistry registry, address token) external {
        registry.setQuoteToken(token, true);
    }
}

contract DbcRegistryTest {
    LaunchConfigRegistry private registry;
    MockUsdgMetadata private usdg;

    function setUp() public {
        usdg = new MockUsdgMetadata();
        LaunchConfigRegistry implementation = new LaunchConfigRegistry();
        registry = LaunchConfigRegistry(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        LaunchConfigRegistry.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        registry.setQuoteToken(address(usdg), true);
        registry.setRole(registry.FACTORY_ROLE(), address(this), true);
    }

    function testCreatesImmutableVersionedTemplate() external {
        DbcTypes.TemplateConfig memory config = _config();
        uint256 first = registry.createTemplate(keccak256("USDG_LINEAR"), config);
        uint256 second = registry.createTemplate(keccak256("USDG_LINEAR"), config);

        LaunchConfigRegistry.TemplateRecord memory firstRecord = registry.template(first);
        LaunchConfigRegistry.TemplateRecord memory secondRecord = registry.template(second);
        require(firstRecord.version == 1, "first version");
        require(secondRecord.version == 2, "second version");
        require(firstRecord.configHash == keccak256(abi.encode(config)), "config hash");
        require(firstRecord.enabled, "template disabled");
        require(firstRecord.config.quoteToken == address(usdg), "quote token");
    }

    function testTemplateCanBeDisabledWithoutMutation() external {
        uint256 templateId = registry.createTemplate(keccak256("USDG_LINEAR"), _config());
        bytes32 beforeHash = registry.template(templateId).configHash;
        registry.setTemplateEnabled(templateId, false);
        LaunchConfigRegistry.TemplateRecord memory record = registry.template(templateId);
        require(!record.enabled, "still enabled");
        require(record.configHash == beforeHash, "config mutated");
    }

    function testFactoryMarksReusableTemplateUsedIdempotently() external {
        uint256 templateId = registry.createTemplate(keccak256("USDG_LINEAR"), _config());
        registry.markTemplateUsed(templateId);
        require(registry.template(templateId).used, "not used");
        registry.markTemplateUsed(templateId);
        require(registry.template(templateId).used, "idempotent use cleared");
    }

    function testRejectsUnallowlistedQuoteAndInvalidSplit() external {
        DbcTypes.TemplateConfig memory config = _config();
        config.quoteToken = address(0xBEEF);
        (bool quoteSuccess,) = address(registry)
            .call(
                abi.encodeCall(
                    LaunchConfigRegistry.createTemplate, (keccak256("BAD_QUOTE"), config)
                )
            );
        require(!quoteSuccess, "unallowlisted quote accepted");

        config = _config();
        config.fees.protocolShareBps = 3_999;
        (bool splitSuccess,) = address(registry)
            .call(
                abi.encodeCall(
                    LaunchConfigRegistry.createTemplate, (keccak256("BAD_SPLIT"), config)
                )
            );
        require(!splitSuccess, "invalid split accepted");
    }

    function testGovernanceRoleBoundaryAndUpgradePreserveState() external {
        UnauthorizedTemplateCaller caller = new UnauthorizedTemplateCaller();
        (bool roleSuccess,) = address(caller)
            .call(
                abi.encodeCall(UnauthorizedTemplateCaller.setQuoteToken, (registry, address(usdg)))
            );
        require(!roleSuccess, "unauthorized template admin accepted");

        uint256 templateId = registry.createTemplate(keccak256("USDG_LINEAR"), _config());
        bytes32 configHash = registry.template(templateId).configHash;
        LaunchConfigRegistry nextImplementation = new LaunchConfigRegistry();
        registry.upgradeToAndCall(address(nextImplementation), "");
        require(registry.template(templateId).configHash == configHash, "upgrade lost template");
        require(registry.quoteTokenAllowed(address(usdg)), "upgrade lost allowlist");
    }

    function _config() private view returns (DbcTypes.TemplateConfig memory config) {
        config.quoteToken = address(usdg);
        config.protocolFeeRecipient = address(0x1001);
        config.partnerFeeRecipient = address(0x1002);
        config.protocolLpRecipient = address(0x1003);
        config.quoteDecimals = 6;
        config.baseDecimals = 18;
        config.migrationMode = DbcTypes.MigrationMode.DAMM;
        config.destinationFeePips = 3_000;
        config.terminalPriceToleranceBps = 100;
        config.totalSupplyRaw = 1_000e18;
        config.baseInventoryRaw = 100e18;
        config.graduationThresholdRaw = 1_000_000;
        config.minimumDestinationShares = 1;
        config.curve.segmentCount = 1;
        config.curve.segments[0] = DbcTypes.LinearSegment({
            initialPriceX18: 0.01e18, slopeX18: 0.00001e18, saleCapacityX18: 100e18
        });
        config.fees = DbcTypes.FeePolicy({
            tradeFeeBps: 100,
            creatorShareBps: 4_000,
            partnerShareBps: 2_000,
            protocolShareBps: 4_000
        });
        config.lp = DbcTypes.LpPolicy({
            creatorShareBps: 5_000, protocolShareBps: 5_000, creatorLockSeconds: 30 days
        });
    }
}
