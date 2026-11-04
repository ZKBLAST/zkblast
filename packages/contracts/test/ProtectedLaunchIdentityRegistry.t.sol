// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    ProtectedLaunchIdentityRegistry
} from "../src/launchpad/protection/ProtectedLaunchIdentityRegistry.sol";
import { ERC1967Proxy } from "../src/proxy/ERC1967Proxy.sol";

contract IdentityContractStub { }

contract IdentityRegistryActor {
    function register(
        ProtectedLaunchIdentityRegistry registry,
        ProtectedLaunchIdentityRegistry.IdentityInput calldata input
    ) external returns (bool success) {
        (success,) = address(registry)
            .call(abi.encodeCall(ProtectedLaunchIdentityRegistry.registerIdentity, (input)));
    }

    function bindLaunchpad(
        ProtectedLaunchIdentityRegistry registry,
        bytes32 launchId,
        uint256 launchpadId
    ) external returns (bool success) {
        (success,) = address(registry).call(
            abi.encodeCall(
                ProtectedLaunchIdentityRegistry.bindLaunchpad,
                (launchId, launchpadId)
            )
        );
    }
}

contract ProtectedLaunchIdentityRegistryTest {
    ProtectedLaunchIdentityRegistry private registry;
    IdentityContractStub private factory;
    IdentityContractStub private token;
    IdentityContractStub private pool;
    IdentityRegistryActor private outsider;

    function setUp() public {
        registry = ProtectedLaunchIdentityRegistry(
            address(
                new ERC1967Proxy(
                    address(new ProtectedLaunchIdentityRegistry()),
                    abi.encodeCall(
                        ProtectedLaunchIdentityRegistry.initialize,
                        (address(this), address(this), address(this))
                    )
                )
            )
        );
        factory = new IdentityContractStub();
        token = new IdentityContractStub();
        pool = new IdentityContractStub();
        outsider = new IdentityRegistryActor();
    }

    function testNormalizesNameAndSymbolCommitments() external view {
        require(
            registry.normalizedCommitment("  ZKBLAST Token  ")
                == registry.normalizedCommitment("zkblast token"),
            "name normalization"
        );
        require(
            registry.normalizedCommitment("ZKB") == registry.normalizedCommitment("zkb"),
            "symbol normalization"
        );
    }

    function testFirstRegistrationWinsAndDuplicatesAreWarnings() external {
        bytes32 firstId = keccak256("FIRST");
        registry.registerIdentity(_input(firstId, "ZKBLAST Token", "ZKB"));

        IdentityContractStub secondToken = new IdentityContractStub();
        IdentityContractStub secondPool = new IdentityContractStub();
        ProtectedLaunchIdentityRegistry.IdentityInput memory second =
            _input(keccak256("SECOND"), "  zkblast token ", "zkb");
        second.token = address(secondToken);
        second.pool = address(secondPool);
        registry.registerIdentity(second);

        ProtectedLaunchIdentityRegistry.Identity memory identity =
            registry.identity(second.launchId);
        require(identity.duplicateName && identity.duplicateSymbol, "duplicate warning");
        require(
            registry.firstLaunchByName(identity.nameCommitment) == firstId,
            "name reservation overwritten"
        );
        require(
            registry.firstLaunchBySymbol(identity.symbolCommitment) == firstId,
            "symbol reservation overwritten"
        );
    }

    function testRejectsUnauthorizedSpoofedAndRepeatedRegistration() external {
        ProtectedLaunchIdentityRegistry.IdentityInput memory valid =
            _input(keccak256("VALID"), "Protected", "PRT");
        require(!outsider.register(registry, valid), "unauthorized registration");

        ProtectedLaunchIdentityRegistry.IdentityInput memory spoofed =
            _input(keccak256("SPOOFED"), "Spoofed", "SPF");
        spoofed.token = address(0x1234);
        (bool spoofSuccess,) = address(registry)
            .call(abi.encodeCall(ProtectedLaunchIdentityRegistry.registerIdentity, (spoofed)));
        require(!spoofSuccess, "EOA token spoof accepted");

        registry.registerIdentity(valid);
        (bool repeated,) = address(registry)
            .call(abi.encodeCall(ProtectedLaunchIdentityRegistry.registerIdentity, (valid)));
        require(!repeated, "launch identity overwritten");
    }

    function testCanonicalHashChangesAcrossLaunchAndRuntimeIdentity() external {
        ProtectedLaunchIdentityRegistry.IdentityInput memory first =
            _input(keccak256("CANONICAL_A"), "Alpha", "ALP");
        bytes32 firstHash = registry.registerIdentity(first);

        IdentityContractStub otherToken = new IdentityContractStub();
        IdentityContractStub otherPool = new IdentityContractStub();
        ProtectedLaunchIdentityRegistry.IdentityInput memory second =
            _input(keccak256("CANONICAL_B"), "Beta", "BET");
        second.token = address(otherToken);
        second.pool = address(otherPool);
        bytes32 secondHash = registry.registerIdentity(second);
        require(firstHash != secondHash, "canonical collision");
    }

    function testBindsUnattributedIdentityToLaunchpadExactlyOnce() external {
        bytes32 launchId = keccak256("HOSTED_PROTECTED");
        ProtectedLaunchIdentityRegistry.IdentityInput memory input =
            _input(launchId, "Hosted Protected", "HPRT");
        input.launchpadId = 0;
        bytes32 unboundHash = registry.registerIdentity(input);
        registry.setRole(registry.LAUNCHPAD_BINDER_ROLE(), address(this), true);

        bytes32 boundHash = registry.bindLaunchpad(launchId, 7);
        ProtectedLaunchIdentityRegistry.Identity memory identity =
            registry.identity(launchId);
        require(identity.launchpadId == 7, "launchpad attribution missing");
        require(boundHash == identity.canonicalHash, "bound hash mismatch");
        require(boundHash != unboundHash, "canonical hash unchanged");

        (bool repeated,) = address(registry).call(
            abi.encodeCall(ProtectedLaunchIdentityRegistry.bindLaunchpad, (launchId, 8))
        );
        require(!repeated, "launchpad attribution overwritten");
    }

    function testRejectsUnauthorizedLaunchpadBinding() external {
        bytes32 launchId = keccak256("UNAUTHORIZED_BINDING");
        ProtectedLaunchIdentityRegistry.IdentityInput memory input =
            _input(launchId, "Hosted Protected", "HPRT2");
        input.launchpadId = 0;
        registry.registerIdentity(input);
        require(
            !outsider.bindLaunchpad(registry, launchId, 7),
            "unauthorized launchpad binding"
        );
    }

    function _input(bytes32 launchId, string memory name, string memory symbol)
        private
        view
        returns (ProtectedLaunchIdentityRegistry.IdentityInput memory input)
    {
        input = ProtectedLaunchIdentityRegistry.IdentityInput({
            launchId: launchId,
            factory: address(factory),
            token: address(token),
            pool: address(pool),
            launchpadId: 1,
            name: name,
            symbol: symbol,
            metadataHash: keccak256("METADATA"),
            socialHash: keccak256("SOCIAL"),
            tokenTemplateVersion: 1
        });
    }
}
