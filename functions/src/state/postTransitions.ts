import { ConflictError } from "../lib/errors";
import type { PostStatus } from "../types";

const ALLOWED: Record<PostStatus, ReadonlySet<PostStatus>> = {
  DRAFT: new Set(["SCHEDULED", "CANCELED"]),
  SCHEDULED: new Set(["PROCESSING", "DRAFT", "CANCELED"]),
  PROCESSING: new Set(["PUBLISHED", "FAILED_RETRY", "FAILED_PERMANENT"]),
  FAILED_RETRY: new Set(["PROCESSING", "FAILED_PERMANENT"]),
  PUBLISHED: new Set(),
  FAILED_PERMANENT: new Set(["SCHEDULED"]),
  CANCELED: new Set(),
};

export function assertPostTransition(from: PostStatus, to: PostStatus): void {
  if (!ALLOWED[from].has(to)) {
    throw new ConflictError(`Illegal post transition ${from} → ${to}`);
  }
}

export function canMutatePost(status: PostStatus): boolean {
  return status === "DRAFT" || status === "SCHEDULED";
}
