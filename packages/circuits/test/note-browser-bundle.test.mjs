import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("strict browser note bundle matches the frozen vector including array inputs", async () => {
  const root = new URL("../../../apps/web/public/zk/", import.meta.url);
  const source = await readFile(new URL("note-worker.js", root), "utf8");
  const wasm = await readFile(new URL("note-vector.wasm", root));
  const input = JSON.parse(
    await readFile(
      new URL("../vectors/v1/base-input.json", import.meta.url),
      "utf8",
    ),
  );
  const manifest = JSON.parse(
    await readFile(
      new URL("../vectors/v1/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const messages = [];
  const context = {
    self: { postMessage: (message) => messages.push(message) },
    WebAssembly,
    console,
    fetch: async (url) => {
      assert.equal(url, "/zk/note-vector.wasm");
      return {
        ok: true,
        arrayBuffer: async () =>
          wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
      };
    },
  };
  vm.runInNewContext(source, context);
  for (const id of ["first", "repeat"]) {
    await context.self.onmessage({ data: { id, input } });
    const message = messages.at(-1);
    assert.equal(message.error, undefined);
    assert.equal(message.id, id);
    assert.deepEqual(
      JSON.parse(JSON.stringify(message.result)),
      manifest.expected,
    );
  }
});
