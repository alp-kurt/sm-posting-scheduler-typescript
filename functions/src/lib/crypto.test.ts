import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decrypt, encrypt, randomToken, sha256 } from "./crypto";

describe("crypto", () => {
  it("round-trips encrypt/decrypt", () => {
    const plain = "refresh-token-xyz";
    assert.equal(decrypt(encrypt(plain)), plain);
  });

  it("produces distinct ciphertexts for the same plaintext (random IV)", () => {
    const plain = "same";
    assert.notEqual(encrypt(plain), encrypt(plain));
  });

  it("sha256 is stable hex", () => {
    assert.equal(
      sha256(Buffer.from("abc")),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("randomToken returns hex of expected length", () => {
    assert.match(randomToken(16), /^[0-9a-f]{32}$/);
  });
});
