import buildWitnessCalculator from "../target/v1-vector/vector-generator_js/witness_calculator.js";

let calculatorPromise;

async function calculator() {
  calculatorPromise ??= fetch("/zk/note-vector.wasm")
    .then((response) => {
      if (!response.ok) throw new Error("NOTE_CIRCUIT_ASSET_UNAVAILABLE");
      return response.arrayBuffer();
    })
    .then((wasm) => buildWitnessCalculator(wasm));
  return calculatorPromise;
}

self.onmessage = async ({ data }) => {
  try {
    const witness = await (await calculator()).calculateWitness(data.input, 0);
    self.postMessage({
      id: data.id,
      result: {
        commitment: witness[1].toString(),
        merkleRoot: witness[2].toString(),
        nullifier: witness[3].toString(),
      },
    });
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
