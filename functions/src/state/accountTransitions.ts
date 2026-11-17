import { ConflictError } from "../lib/errors";
import type { AccountStatus } from "../types";

const ALLOWED: Record<AccountStatus, ReadonlySet<AccountStatus>> = {
  PENDING_OAUTH: new Set(["ACTIVE", "REVOKED"]),
  ACTIVE: new Set(["REFRESHING", "EXPIRED", "REVOKED"]),
  REFRESHING: new Set(["ACTIVE", "EXPIRED", "REVOKED"]),
  EXPIRED: new Set(["ACTIVE", "REVOKED"]),
  REVOKED: new Set(),
};

export function assertAccountTransition(from: AccountStatus, to: AccountStatus): void {
  if (!ALLOWED[from].has(to)) {
    throw new ConflictError(`Illegal account transition ${from} → ${to}`);
  }
}
