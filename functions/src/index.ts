import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createApp } from "./app";
import { publishDuePosts, reconcileMissedJobs } from "./services/publishWorker";

const app = createApp();

export const api = onRequest(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
    cors: false,
  },
  app,
);

export const publishDuePostsJob = onSchedule(
  {
    schedule: "every 1 minutes",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => {
    await reconcileMissedJobs();
    await publishDuePosts();
  },
);
