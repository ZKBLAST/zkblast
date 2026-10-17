# ZK circuits

Selected stack: Circom 2.2.3 with pinned snarkjs/Groth16 and the TACEO Poseidon2 BN254 implementation. Noir/UltraHonk remains benchmark evidence only after failing the verifier-gas gate.

`architecture/withdraw-v1.json` is the machine-readable contract between circuit, SDK, verifier adapter, vault, tests, and documentation. Its public-input order is consensus-critical and must not be reordered. A semantic change requires a new version.

Generated witnesses, proofs, keys, and `target/` files remain ignored. Reviewed circuit sources, deterministic vectors, version manifests, and hashes are committed.

## Withdrawal circuit v1

`src/v1/withdraw.circom` implements the frozen 13-field withdrawal schema. It uses the vendored, pinned TACEO Poseidon2 BN254 permutation with ZKBLAST-specific note, nullifier, and level-aware Merkle domains. The vendored files retain their MIT license and hashes in `architecture/withdraw-v1-artifacts.json`.

```sh
pnpm v1:build
pnpm v1:test
```

Generated R1CS, WASM, witnesses, Powers of Tau files, proving keys, proofs, and Solidity verifiers stay under ignored `target/`. No proving key may be deployed until the phase-2 policy and contributors are approved and the resulting transcript and hashes are published.
