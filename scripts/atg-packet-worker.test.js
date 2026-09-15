const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { deflateSync } = require("node:zlib");
const test = require("node:test");

function worker(io) {
  const window = {
    location: { href: "https://play.godeebxp.com/" },
    addEventListener() {},
    io,
  };
  const context = vm.createContext({
    window, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, Blob,
    Response, DecompressionStream, crypto: webcrypto, setTimeout, clearTimeout,
    console: { info() {}, warn() {} },
  });
  const source = fs.readFileSync(path.join(__dirname, "../extensions/mb-relay/atg-packet-worker.js"), "utf8");
  vm.runInContext(source.replace(/\}\(\)\);\s*$/, "window.testApi = { decryptResponse, decodeGameResponse, connectGame }; }());"), context);
  return window.testApi;
}

async function encrypted(bytes, token = "fixture-ticket", salt = "") {
  const digest = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(token + salt));
  const key = await webcrypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return new Uint8Array([...iv, ...body.slice(-16), ...body.slice(0, -16)]);
}

test("encrypted response accepts a current fallback ticket and a byte-offset view", async () => {
  const packet = await encrypted(deflateSync(JSON.stringify({ status: 200, tables: [1, 2] })));
  const padded = new Uint8Array(packet.length + 8);
  padded.set(packet, 4);
  const result = await worker().decodeGameResponse(padded.subarray(4, -4), ["wrong-ticket", "fixture-ticket"]);
  assert.equal(result.status, 200);
  assert.deepEqual(Array.from(result.tables), [1, 2]);
});

test("current official salted key derivation decodes newer game responses", async () => {
  const packet = await encrypted(deflateSync(JSON.stringify({ status: 200, game: "g1005" })), "fixture-ticket", "1aabf663faf8");
  const result = await worker().decodeGameResponse(packet, ["old-ticket", "fixture-ticket"]);
  assert.equal(result.status, 200);
  assert.equal(result.game, "g1005");
});

test("authenticated corrupt compression is not mislabeled as a ticket error", async () => {
  const packet = await encrypted(new TextEncoder().encode("invalid deflate"));
  await assert.rejects(worker().decryptResponse(packet, ["fixture-ticket", "wrong-ticket"]), /response decompression failed/);
});

test("authenticated invalid JSON is reported separately", async () => {
  const packet = await encrypted(deflateSync("not JSON"));
  await assert.rejects(worker().decryptResponse(packet, ["fixture-ticket", "wrong-ticket"]), /response JSON parsing failed/);
});

test("wrong tickets still fail authentication without exposing credentials", async () => {
  const packet = await encrypted(deflateSync("{}"));
  await assert.rejects(worker().decryptResponse(packet, ["wrong-ticket", "wrong-ticket"]), (error) => {
    assert.match(error.message, /1 active ticket/);
    assert.equal(error.message.includes("wrong-ticket"), false);
    return true;
  });
});

test("failed initialization closes its socket before connectGame rejects", async () => {
  let closes = 0;
  const socket = {
    connected: true,
    once(event, callback) { if (event === "connect") queueMicrotask(callback); },
    on() {},
    close() { closes += 1; this.connected = false; },
    emit(event, payload, callback) { callback(new Uint8Array(40)); },
  };
  const api = worker(() => socket);
  await assert.rejects(api.connectGame({ target: { name: "test" }, token: "fixture-ticket" }, { locale: "zh-tw" }), /initial: encrypted response/);
  assert.equal(closes, 1);
  assert.equal(socket.connected, false);
});
