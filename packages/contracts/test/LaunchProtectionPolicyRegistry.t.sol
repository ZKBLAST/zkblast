// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    LaunchProtectionPolicyRegistry
} from "../src/launchpad/protection/LaunchProtectionPolicyRegistry.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

contract ProtectionPolicyActor {
    function create(
        LaunchProtectionPolicyRegistry registry,
        LaunchProtectionPolicyRegistry.PolicyInput calldata input
    ) external returns (bool success) {
        (success,) = address(registry)
            .call(abi.encodeCall(LaunchProtectionPolicyRegistry.createPolicy, (input)));
    }

    function consume(LaunchProtectionPolicyRegistry registry, uint256 policyId)
        external
        returns (bool success)
    {
        (success,) = address(registry)
            .call(abi.encodeCall(LaunchProtectionPolicyRegistry.markPolicyUsed, (policyId)));
    }
}

contract LaunchProtectionPolicyRegistryTest {
    LaunchProtectionPolicyRegistry private registry;
    ProtectionPolicyActor private consumer;
    ProtectionPolicyActor private outsider;

    function setUp() public {
        LaunchProtectionPolicyRegistry implementation = new LaunchProtectionPolicyRegistry();
        registry = LaunchProtectionPolicyRegistry(
            address(
                new ERC1967Proxy(
                    address(implementation),
                    abi.encodeCall(
                        LaunchProtectionPolicyRegistry.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        consumer = new ProtectionPolicyActor();
        outsider = new ProtectionPolicyActor();
        registry.setRole(registry.POLICY_CONSUMER_ROLE(), address(consumer), true);
    }

    function testCreatesImmutableVersionedPolicies() external {
        uint256 first = registry.createPolicy(_input());
        uint256 second = registry.createPolicy(_input());
        LaunchProtectionPolicyRegistry.Policy memory firstPolicy = registry.policy(first);
        LaunchProtectionPolicyRegistry.Policy memory secondPolicy = registry.policy(second);

        require(first == 1 && second == 2, "policy ids");
        require(firstPolicy.version == 1 && secondPolicy.version == 2, "versions");
        require(firstPolicy.policyHash == secondPolicy.policyHash, "deterministic policy");
        require(firstPolicy.maxBuyBpsPerTransaction == 25, "transaction cap");
        require(firstPolicy.maxBuyBpsPerAddress == 100, "address cap");
        require(firstPolicy.enabled && !firstPolicy.used, "initial state");
    }

    function testOnlyAuthorizedConsumerMarksPolicyUsed() external {
        uint256 policyId = registry.createPolicy(_input());
        require(!outsider.consume(registry, policyId), "outsider consumed policy");
        require(consumer.consume(registry, policyId), "consumer failed");
        require(registry.policy(policyId).used, "usage not recorded");
        require(consumer.consume(registry, policyId), "idempotent consume failed");
    }

    function testDisabledPolicyCannotBeConsumedButRemainsReadable() external {
        uint256 policyId = registry.createPolicy(_input());
        registry.setPolicyEnabled(policyId, false);
        require(!consumer.consume(registry, policyId), "disabled policy consumed");
        require(!registry.policy(policyId).enabled, "status not retained");
    }

    function testRejectsInvalidBoundsAndUnsupportedBatchMode() external {
        LaunchProtectionPolicyRegistry.PolicyInput memory input = _input();
        input.maxBuyBpsPerTransaction = 101;
        require(!outsider.create(registry, input), "unauthorized invalid policy created");

        input = _input();
        input.maxBuyBpsPerAddress = 24;
        require(!_create(input), "inverted caps accepted");

        input = _input();
        input.initialFeeBps = 501;
        require(!_create(input), "fee cap exceeded");

        input = _input();
        input.batchMode = true;
        require(!_create(input), "batch mode enabled early");
    }

    function testImplementationCannotBeInitialized() external {
        LaunchProtectionPolicyRegistry implementation = new LaunchProtectionPolicyRegistry();
        (bool success,) = address(implementation)
            .call(
                abi.encodeCall(
                    LaunchProtectionPolicyRegistry.initialize,
                    (address(this), address(this), address(this))
                )
            );
        require(!success, "implementation initialized");
    }

    function _create(LaunchProtectionPolicyRegistry.PolicyInput memory input)
        private
        returns (bool success)
    {
        (success,) = address(registry)
            .call(abi.encodeCall(LaunchProtectionPolicyRegistry.createPolicy, (input)));
    }

    function _input()
        private
        pure
        returns (LaunchProtectionPolicyRegistry.PolicyInput memory input)
    {
        input = LaunchProtectionPolicyRegistry.PolicyInput({
                familyId: keccak256("PROTECTED_LINEAR_V1"),
                protectionBlocks: 100,
                maxBuyBpsPerTransaction: 25,
                maxBuyBpsPerAddress: 100,
                initialFeeBps: 100,
                baseFeeBps: 30,
                lpLockSeconds: 30 days,
                batchMode: false
            });
    }
}
