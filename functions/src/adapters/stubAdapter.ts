import type { MediaDoc, Platform, PostDoc, PostTarget } from "../types";
import { PublishError, type PlatformAdapter, type PublishResult } from "./types";

export function createStubAdapter(platform: Platform): PlatformAdapter {
  return {
    platform,
    async publish(
      _post: PostDoc,
      _target: PostTarget,
      _media: MediaDoc[],
      _credentials: { accessToken: string; refreshToken?: string },
    ): Promise<PublishResult> {
      throw new PublishError(
        `Platform adapter for ${platform} is not implemented`,
        "permanent",
        "NOT_IMPLEMENTED",
      );
    },
  };
}

export function getAdapter(platform: Platform): PlatformAdapter {
  return createStubAdapter(platform);
}
