import { findUserByEmail, findUserById, updateUserGmailSyncState } from "../repositories/users.js";
import { listSubscriptionsByUser, upsertSubscription } from "../repositories/subscriptions.js";
import {
  extractNewSubscriptionsFromGmail,
  extractSubscriptionsFromGmail,
  watchGmailInbox
} from "./gmail.js";

const runningScans = new Map();
const liveMonitors = new Map();
const LIVE_POLL_INTERVAL_MS = 15000;

function publicSubscription(item) {
  if (!item) return null;
  return item.status === "verified" ? item : null;
}

function shouldPersistSubscription(item) {
  return item?.status === "verified";
}

export function registerLiveScanSocket(io) {
  io.on("connection", (socket) => {
    const userId = socket.request.session?.userId;

    if (!userId) {
      socket.emit("auth:required");
      return;
    }

    socket.join(`user:${userId}`);
    socket.emit("scan:ready");
    startLiveMonitor({ io, userId });

    socket.on("scan:start", async () => {
      await startLiveScan({ io, userId });
    });

    socket.on("disconnect", () => {
      const room = io.sockets.adapter.rooms.get(`user:${userId}`);
      if (!room || room.size === 0) stopLiveMonitor(userId);
    });
  });
}

export async function startLiveScan({ io, userId }) {
  const room = `user:${userId}`;
  if (runningScans.has(userId)) {
    io.to(room).emit("scan:already-running");
    return runningScans.get(userId);
  }

  const scanPromise = runScan({ io, userId, room }).finally(() => {
    runningScans.delete(userId);
  });

  runningScans.set(userId, scanPromise);
  return scanPromise;
}

async function runScan({ io, userId, room }) {
  try {
    const user = await findUserById(userId);
    if (!user) {
      io.to(room).emit("scan:error", { message: "Gmail account is no longer connected" });
      return;
    }

    console.log(`[live-scan] Requested by ${user.email}`);
    const scanResult = await extractSubscriptionsFromGmail(user, {
      emit: (event, payload) => io.to(room).emit(event, payload),
      onCandidate: async (candidate, meta) => {
        if (!shouldPersistSubscription(candidate)) return;
        const saved = await upsertSubscription(user.id, candidate);
        const visible = publicSubscription(saved);
        if (visible) {
          io.to(room).emit("subscription:found", {
            subscription: visible,
            meta
          });
        }
      }
    });

    await updateUserGmailSyncState(user.id, { historyId: scanResult.historyId });
    const subscriptions = await listSubscriptionsByUser(user.id);
    const storedCount = subscriptions.length;
    io.to(room).emit("subscriptions:replace", {
      subscriptions,
      imported: storedCount
    });
    io.to(room).emit("scan:done", {
      imported: storedCount,
      visible: subscriptions.filter(publicSubscription).length
    });
    await enableGmailWatchIfConfigured(user.id);
    startLiveMonitor({ io, userId });
    console.log(
      `[live-scan] Extracted ${scanResult.subscriptions.length} candidates and kept ${storedCount} verified records for ${user.email}`
    );
  } catch (error) {
    console.error("[live-scan] Failed", error);
    io.to(room).emit("scan:error", {
      message: "Live Gmail scan failed. Check the backend logs for details."
    });
  }
}

function startLiveMonitor({ io, userId }) {
  if (liveMonitors.has(userId)) return;

  const monitor = setInterval(() => {
    processNewGmailMessages({ io, userId }).catch((error) => {
      console.error("[gmail-live] Poll failed", error);
    });
  }, LIVE_POLL_INTERVAL_MS);

  liveMonitors.set(userId, monitor);
}

function stopLiveMonitor(userId) {
  const monitor = liveMonitors.get(userId);
  if (!monitor) return;
  clearInterval(monitor);
  liveMonitors.delete(userId);
}

export async function processNewGmailMessages({ io, userId }) {
  const room = `user:${userId}`;
  const user = await findUserById(userId);
  if (!user?.gmailTokens) return;

  const result = await extractNewSubscriptionsFromGmail(user, {
    onCandidate: async (candidate, meta) => {
      if (!shouldPersistSubscription(candidate)) return;
      const saved = await upsertSubscription(user.id, candidate);
      const visible = publicSubscription(saved);
      if (visible) {
        io.to(room).emit("subscription:found", {
          subscription: visible,
          meta,
          live: true
        });
        io.to(room).emit("live:payment", {
          message: `${visible.merchantName} payment notification detected`,
          subscription: visible
        });
      }
    }
  });

  if (result.historyId && result.historyId !== user.gmailHistoryId) {
    await updateUserGmailSyncState(user.id, { historyId: result.historyId });
  }
}

export async function processGmailPushNotification({ io, payload }) {
  const message = payload?.message;
  if (!message?.data) return;

  const decoded = JSON.parse(Buffer.from(message.data, "base64").toString("utf8"));
  const user = decoded.emailAddress ? await findUserByEmail(decoded.emailAddress) : null;
  if (!user) return;

  if (decoded.historyId && !user.gmailHistoryId) {
    await updateUserGmailSyncState(user.id, { historyId: decoded.historyId });
    return;
  }

  await processNewGmailMessages({ io, userId: user.id });
}

async function enableGmailWatchIfConfigured(userId) {
  const user = await findUserById(userId);
  if (!user) return;

  try {
    const watch = await watchGmailInbox(user);
    if (watch?.historyId) {
      await updateUserGmailSyncState(user.id, { historyId: watch.historyId });
      console.log(`[gmail-watch] Enabled for ${user.email}`);
    }
  } catch (error) {
    console.warn(`[gmail-watch] Not enabled for ${user.email}: ${error.message}`);
  }
}
