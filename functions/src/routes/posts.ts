import { Router } from "express";
import { AppError, BadRequestError } from "../lib/errors";
import { requireSession, type AuthedRequest } from "../middleware/auth";
import {
  cancelPost,
  createPost,
  getPost,
  retryPermanentFailure,
  schedulePost,
  updatePost,
} from "../services/postService";

export const postsRouter = Router();

postsRouter.post("/", requireSession, async (req: AuthedRequest, res) => {
  try {
    const { text, mediaIds, accountIds, scheduledAt } = req.body ?? {};
    if (!Array.isArray(accountIds)) throw new BadRequestError("accountIds array required");
    const post = await createPost({
      userId: req.userId!,
      text: typeof text === "string" ? text : "",
      mediaIds: Array.isArray(mediaIds) ? mediaIds : [],
      accountIds,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    });
    res.status(201).json(serializePost(post));
  } catch (err) {
    sendErr(res, err, "Create post failed");
  }
});

postsRouter.get("/:id", requireSession, async (req: AuthedRequest, res) => {
  try {
    const post = await getPost(req.params.id, req.userId!);
    res.json(serializePost(post));
  } catch (err) {
    sendErr(res, err, "Get post failed");
  }
});

postsRouter.patch("/:id", requireSession, async (req: AuthedRequest, res) => {
  try {
    const body = req.body ?? {};
    const post = await updatePost(req.params.id, req.userId!, {
      text: body.text,
      mediaIds: body.mediaIds,
      accountIds: body.accountIds,
      scheduledAt:
        body.scheduledAt === null
          ? null
          : body.scheduledAt !== undefined
            ? new Date(body.scheduledAt)
            : undefined,
    });
    res.json(serializePost(post));
  } catch (err) {
    sendErr(res, err, "Update post failed");
  }
});

postsRouter.post("/:id/schedule", requireSession, async (req: AuthedRequest, res) => {
  try {
    const scheduledAt = req.body?.scheduledAt
      ? new Date(req.body.scheduledAt)
      : undefined;
    const post = await schedulePost(req.params.id, req.userId!, scheduledAt);
    res.json(serializePost(post));
  } catch (err) {
    sendErr(res, err, "Schedule post failed");
  }
});

postsRouter.post("/:id/cancel", requireSession, async (req: AuthedRequest, res) => {
  try {
    const post = await cancelPost(req.params.id, req.userId!);
    res.json(serializePost(post));
  } catch (err) {
    sendErr(res, err, "Cancel post failed");
  }
});

postsRouter.post("/:id/retry", requireSession, async (req: AuthedRequest, res) => {
  try {
    if (!req.body?.scheduledAt) throw new BadRequestError("scheduledAt required");
    const post = await retryPermanentFailure(
      req.params.id,
      req.userId!,
      new Date(req.body.scheduledAt),
    );
    res.json(serializePost(post));
  } catch (err) {
    sendErr(res, err, "Retry post failed");
  }
});

function serializePost(post: {
  id: string;
  status: string;
  text: string;
  mediaIds: string[];
  targets: unknown[];
  scheduledAt?: FirebaseFirestore.Timestamp;
  processingStartedAt?: FirebaseFirestore.Timestamp;
  retryCount: number;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}) {
  return {
    id: post.id,
    status: post.status,
    text: post.text,
    mediaIds: post.mediaIds,
    targets: post.targets,
    scheduledAt: post.scheduledAt?.toDate().toISOString() ?? null,
    processingStartedAt: post.processingStartedAt?.toDate().toISOString() ?? null,
    retryCount: post.retryCount,
    createdAt: post.createdAt.toDate().toISOString(),
    updatedAt: post.updatedAt.toDate().toISOString(),
  };
}

function sendErr(res: import("express").Response, err: unknown, fallback: string) {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  res.status(500).json({ error: "INTERNAL", message: fallback });
}
