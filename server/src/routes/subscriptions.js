import express from "express";
import { findUserById, updateUserGmailSyncState } from "../repositories/users.js";
import {
  listSubscriptionsByUser,
  upsertSubscription,
  verifySubscription
} from "../repositories/subscriptions.js";
import { extractSubscriptionsFromGmail } from "../services/gmail.js";
import { emitScanEvent, subscribeToScanEvents } from "../services/scanEvents.js";

const router = express.Router();

function requireUser(request, response, next) {
  if (!request.session.userId) {
    return response.status(401).json({ message: "Connect Gmail before syncing subscriptions" });
  }
  next();
}

router.get("/", async (request, response, next) => {
  try {
    if (!request.session.userId) {
      return response.json({ subscriptions: [] });
    }

    const subscriptions = await listSubscriptionsByUser(request.session.userId);
    response.json({ subscriptions });
  } catch (error) {
    next(error);
  }
});

router.post("/sync", requireUser, async (request, response, next) => {
  try {
    const user = await findUserById(request.session.userId);
    if (!user) {
      return response.status(401).json({ message: "Gmail account is no longer connected" });
    }

    console.log(`[sync] Requested by ${user.email}`);
    const scanResult = await extractSubscriptionsFromGmail(user, {
      emit: (event, payload) => emitScanEvent(user.id, event, payload)
    });

    const verifiedSubscriptions = scanResult.subscriptions.filter(
      (subscription) => subscription.status === "verified"
    );

    for (const item of verifiedSubscriptions) {
      await upsertSubscription(user.id, item);
    }

    const subscriptions = await listSubscriptionsByUser(user.id);
    await updateUserGmailSyncState(user.id, { historyId: scanResult.historyId });
    console.log(
      `[sync] Extracted ${scanResult.subscriptions.length} candidates and kept ${verifiedSubscriptions.length} verified records. User now has ${subscriptions.length} saved records.`
    );

    response.json({ subscriptions, imported: verifiedSubscriptions.length });
  } catch (error) {
    next(error);
  }
});

router.get("/events", requireUser, (request, response) => {
  subscribeToScanEvents(request.session.userId, response);
});

router.patch("/:id/verify", requireUser, async (request, response, next) => {
  try {
    const subscription = await verifySubscription(request.session.userId, request.params.id);

    response.json({ subscription });
  } catch (error) {
    next(error);
  }
});

export default router;
