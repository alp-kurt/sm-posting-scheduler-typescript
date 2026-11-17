import { ConflictError } from "../lib/errors";
import type { MediaStatus } from "../types";

const ALLOWED: Record<MediaStatus, ReadonlySet<MediaStatus>> = {
  UPLOADING: new Set(["VALIDATED", "REJECTED"]),
  VALIDATED: new Set(["ATTACHED", "PURGED"]),
  REJECTED: new Set(["PURGED"]),
  ATTACHED: new Set(["PURGED"]),
  PURGED: new Set(),
};

export function assertMediaTransition(from: MediaStatus, to: MediaStatus): void {
  if (!ALLOWED[from].has(to)) {
    throw new ConflictError(`Illegal media transition ${from} → ${to}`);
  }
}
