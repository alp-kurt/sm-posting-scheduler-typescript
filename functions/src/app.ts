import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { authRouter } from "./routes/auth";
import { mediaRouter } from "./routes/media";
import { notificationsRouter } from "./routes/notifications";
import { oauthRouter } from "./routes/oauth";
import { postsRouter } from "./routes/posts";

export function createApp() {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/auth", authRouter);
  app.use("/oauth", oauthRouter);
  app.use("/media", mediaRouter);
  app.use("/posts", postsRouter);
  app.use("/notifications", notificationsRouter);

  return app;
}
