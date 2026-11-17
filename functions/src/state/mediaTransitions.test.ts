import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictError } from "../lib/errors";
import { assertMediaTransition } from "./mediaTransitions";

describe("assertMediaTransition", () => {
  it("allows UPLOADING → VALIDATED → ATTACHED → PURGED", () => {
    assert.doesNotThrow(() => assertMediaTransition("UPLOADING", "VALIDATED"));
    assert.doesNotThrow(() => assertMediaTransition("VALIDATED", "ATTACHED"));
    assert.doesNotThrow(() => assertMediaTransition("ATTACHED", "PURGED"));
  });

  it("rejects PURGED → VALIDATED", () => {
    assert.throws(() => assertMediaTransition("PURGED", "VALIDATED"), ConflictError);
  });
});
