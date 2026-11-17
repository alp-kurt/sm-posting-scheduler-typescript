import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictError } from "../lib/errors";
import { assertPostTransition, canMutatePost } from "./postTransitions";

describe("assertPostTransition", () => {
  it("allows DRAFT → SCHEDULED", () => {
    assert.doesNotThrow(() => assertPostTransition("DRAFT", "SCHEDULED"));
  });

  it("rejects PUBLISHED → DRAFT", () => {
    assert.throws(() => assertPostTransition("PUBLISHED", "DRAFT"), ConflictError);
  });

  it("allows FAILED_PERMANENT → SCHEDULED", () => {
    assert.doesNotThrow(() => assertPostTransition("FAILED_PERMANENT", "SCHEDULED"));
  });

  it("canMutatePost only for DRAFT/SCHEDULED", () => {
    assert.equal(canMutatePost("DRAFT"), true);
    assert.equal(canMutatePost("PROCESSING"), false);
    assert.equal(canMutatePost("CANCELED"), false);
  });
});
