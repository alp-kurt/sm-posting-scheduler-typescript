import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictError } from "../lib/errors";
import { assertAccountTransition } from "./accountTransitions";

describe("assertAccountTransition", () => {
  it("allows PENDING_OAUTH → ACTIVE", () => {
    assert.doesNotThrow(() => assertAccountTransition("PENDING_OAUTH", "ACTIVE"));
  });

  it("allows ACTIVE → REFRESHING → ACTIVE", () => {
    assert.doesNotThrow(() => assertAccountTransition("ACTIVE", "REFRESHING"));
    assert.doesNotThrow(() => assertAccountTransition("REFRESHING", "ACTIVE"));
  });

  it("rejects REVOKED → ACTIVE", () => {
    assert.throws(() => assertAccountTransition("REVOKED", "ACTIVE"), ConflictError);
  });
});
