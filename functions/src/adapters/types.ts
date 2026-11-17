import type { MediaDoc, Platform, PostDoc, PostTarget } from "../types";

export type PublishErrorKind = "transient" | "permanent";

export class PublishError extends Error {
  constructor(
    message: string,
    readonly kind: PublishErrorKind,
    readonly code: string,
  ) {
    super(message);
    this.name = "PublishError";
  }
}

export interface PublishResult {
  externalPostUrl?: string;
}

export interface PlatformAdapter {
  readonly platform: Platform;
  publish(
    post: PostDoc,
    target: PostTarget,
    media: MediaDoc[],
    credentials: { accessToken: string; refreshToken?: string },
  ): Promise<PublishResult>;
}
