# Upstream provenance

- Repository: `https://github.com/TaceoLabs/poseidon2-solidity`
- Pinned commit: `4c599a08a45cd465a153d724425cee331c010df1`
- Release lineage: `v0.3.0`
- License: MIT (see `LICENSE`)
- Imported primitive: `src/Poseidon2T4_BN254.sol`

The wrapper in `src/privacy/Poseidon2FieldHasher.sol` fixes the withdrawal-v1 Merkle domain
and input order. `test/Poseidon2FieldHasher.t.sol` checks the implementation against the frozen
Circom vector before any testnet deployment.
