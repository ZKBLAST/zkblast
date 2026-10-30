import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const output = await mkdtemp(path.join(tmpdir(), "zkblast-perps-vectors-"));
const destination = path.join(root, "vectors/perps-v1");

async function compile(source, name) {
  await run(path.join(root, "node_modules/.bin/circom2"), [
    path.join(root, source), "--wasm", "-o", output,
  ]);
  const folder = path.join(output, `${name}_js`);
  return require(path.join(folder, "witness_calculator.js"))(
    await readFile(path.join(folder, `${name}.wasm`)),
  );
}

const base = {
  chain_id: "4663", settlement: "250", tree_version: "2",
  resource_kind: "0", resource_address: "200", pool_model: "0",
  bin_index: String(1 << 23), action: "1", terms_low: "0", terms_high: "0",
  deadline: "2000000000", path_siblings: Array(32).fill("1"),
  path_directions: Array(32).fill("0"),
};

try {
  const [noteVector, positionVector, openCircuit, closeCircuit, modifyCircuit, claimCircuit] = await Promise.all([
    compile("src/v2/spend-vector.circom", "spend-vector"),
    compile("src/perps/position-vector.circom", "position-vector"),
    compile("src/perps/open.circom", "open"),
    compile("src/perps/close.circom", "close"),
    compile("src/perps/modify.circom", "modify"),
    compile("src/perps/claim-liquidated.circom", "claim-liquidated"),
  ]);
  async function note(amount, secret, nonce) {
    const input = { ...base, amount: String(amount), secret: String(secret), nonce: String(nonce) };
    const witness = await noteVector.calculateWitness(input, true);
    return { input, commitment: String(witness[1]), root: String(witness[2]), nullifier: String(witness[3]) };
  }
  async function position(secret, nonce, leverage = 20_000, margin = 1_000_000) {
    const input = {
      chain_id: "4663", adapter: "100", market_low: "123", market_high: "456",
      is_long: "1", margin: String(margin), leverage_bps: String(leverage),
      owner_secret: String(secret), owner_nonce: String(nonce),
    };
    const witness = await positionVector.calculateWitness(input, true);
    return { input, commitment: String(witness[1]), nullifier: String(witness[2]) };
  }
  const inputNote = await note(1_100_000, 101, 201);
  const refundNote = await note(99_000, 102, 202);
  const control = await position(301, 401);
  const open = {
    schema_version: "1", action: "1", chain_id: "4663", adapter: "100", custody: "250", collateral: "200",
    tree_version: "2", merkle_root: inputNote.root, market_low: "123", market_high: "456",
    is_long: "1", margin: "1000000", leverage_bps: "20000",
    acceptable_price_x18: "2000000000000000000000", deadline: "2000000000",
    nullifier: inputNote.nullifier, position_commitment: control.commitment,
    refund_commitment: refundNote.commitment, relayer: "300", relayer_fee: "1000",
    note_amount: "1100000", note_secret: "101", note_nonce: "201", leaf_index: "0",
    path_siblings: base.path_siblings, path_directions: base.path_directions,
    refund_amount: "99000", refund_secret: "102", refund_nonce: "202",
    position_owner_secret: "301", position_owner_nonce: "401",
  };
  await openCircuit.calculateWitness(open, true);

  const payout = await note(1_099_000, 501, 601);
  const close = {
    schema_version: "1", action: "2", chain_id: "4663", adapter: "100", custody: "250", collateral: "200",
    tree_version: "2", market_low: "123", market_high: "456",
    position_commitment: control.commitment, position_nullifier: control.nullifier,
    expected_payout: "1100000", acceptable_price_x18: "1990000000000000000000",
    deadline: "2000000000", payout_commitment: payout.commitment, relayer: "300", relayer_fee: "1000",
    is_long: "1", margin: "1000000", leverage_bps: "20000",
    position_owner_secret: "301", position_owner_nonce: "401", payout_secret: "501", payout_nonce: "601",
  };
  await closeCircuit.calculateWitness(close, true);
  const nextControl = await position(302, 402, 30_000, 998_000);
  const modify = {
    schema_version: "1", action: "3", chain_id: "4663", adapter: "100",
    market_low: "123", market_high: "456", is_long: "1", old_margin: "1000000",
    expected_new_margin: "998000",
    old_leverage_bps: "20000", new_leverage_bps: "30000",
    old_position_commitment: control.commitment, old_position_nullifier: control.nullifier,
    new_position_commitment: nextControl.commitment,
    acceptable_close_price_x18: "1995000000000000000000",
    acceptable_open_price_x18: "2005000000000000000000", deadline: "2000000000",
    relayer: "300", relayer_fee: "1000", old_owner_secret: "301",
    old_owner_nonce: "401", new_owner_secret: "302", new_owner_nonce: "402",
  };
  await modifyCircuit.calculateWitness(modify, true);
  const residualPayout = await note(499_000, 701, 801);
  const claim = {
    schema_version: "1", action: "4", chain_id: "4663", adapter: "100",
    custody: "250", collateral: "200", tree_version: "2", market_low: "123", market_high: "456",
    position_commitment: control.commitment, position_nullifier: control.nullifier,
    expected_residual: "500000", deadline: "2000000000",
    payout_commitment: residualPayout.commitment, relayer: "300", relayer_fee: "1000",
    is_long: "1", margin: "1000000", leverage_bps: "20000",
    position_owner_secret: "301", position_owner_nonce: "401",
    payout_secret: "701", payout_nonce: "801",
  };
  await claimCircuit.calculateWitness(claim, true);
  const negatives = [
    [openCircuit, { ...open, chain_id: "4664" }, "wrong-chain"],
    [openCircuit, { ...open, adapter: "101" }, "wrong-adapter"],
    [openCircuit, { ...open, custody: "251" }, "wrong-custody"],
    [openCircuit, { ...open, market_low: "124" }, "wrong-market"],
    [openCircuit, { ...open, merkle_root: "1" }, "wrong-root"],
    [openCircuit, { ...open, leverage_bps: "100001" }, "leverage-out-of-range"],
    [closeCircuit, { ...close, expected_payout: "1100001" }, "payout-mismatch"],
    [closeCircuit, { ...close, expected_payout: "1000" }, "relayer-fee-consumes-payout"],
    [modifyCircuit, { ...modify, new_position_commitment: control.commitment }, "modify-commitment-reuse"],
    [claimCircuit, { ...claim, expected_residual: "500001" }, "residual-mismatch"],
  ];
  for (const [calculator, input, label] of negatives) {
    await assert.rejects(() => calculator.calculateWitness(input, true), label);
  }
  await mkdir(destination, { recursive: true });
  await Promise.all([
    writeFile(path.join(destination, "open-valid.json"), `${JSON.stringify(open, null, 2)}\n`),
    writeFile(path.join(destination, "close-valid.json"), `${JSON.stringify(close, null, 2)}\n`),
    writeFile(path.join(destination, "modify-valid.json"), `${JSON.stringify(modify, null, 2)}\n`),
    writeFile(path.join(destination, "claim-liquidated-valid.json"), `${JSON.stringify(claim, null, 2)}\n`),
    writeFile(path.join(destination, "negative-mutations.json"), `${JSON.stringify(negatives.map(([, , label]) => label), null, 2)}\n`),
  ]);
  process.stdout.write(`Perps vectors: 4 valid witnesses, ${negatives.length} rejected mutations\n`);
} finally {
  await rm(output, { recursive: true, force: true });
}
