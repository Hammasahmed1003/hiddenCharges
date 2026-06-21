import crypto from "node:crypto";
import express from "express";
import { config } from "../config.js";
import {
  findOwnerByEmail,
  findOwnerByLemonSubscriptionId,
  findOwnerIdForMember,
  findUserById,
  updateOwnerPlan
} from "../repositories/users.js";
import { normalizePlan, planForVariant, publicPlan } from "../services/plans.js";

const router = express.Router();

function verifyWebhookSignature(request) {
  if (!config.lemonSqueezy.webhookSecret) return true;
  const signature = request.get("x-signature");
  if (!signature || !request.rawBody) return false;
  const expected = crypto
    .createHmac("sha256", config.lemonSqueezy.webhookSecret)
    .update(request.rawBody)
    .digest("hex");
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

function mysqlDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function extractSubscriptionPayload(body) {
  const attributes = body?.data?.attributes || {};
  const meta = body?.meta || {};
  const customData = meta.custom_data || attributes.custom_data || {};
  const firstOrderItem = attributes.first_order_item || {};
  const variantId =
    attributes.variant_id ||
    attributes.product_options?.variant_id ||
    firstOrderItem.variant_id ||
    customData.variant_id;

  return {
    eventName: meta.event_name || body?.event_name || "",
    ownerUserId: customData.owner_user_id || customData.user_id || null,
    email: attributes.user_email || attributes.customer_email || customData.email || null,
    customerId: attributes.customer_id || attributes.customer?.id || null,
    subscriptionId: body?.data?.id || attributes.subscription_id || null,
    variantId,
    status: attributes.status || "active",
    renewsAt: attributes.renews_at || attributes.ends_at || attributes.trial_ends_at || null
  };
}

async function findWebhookOwner(payload) {
  if (payload.ownerUserId) {
    return findUserById(payload.ownerUserId);
  }

  if (payload.subscriptionId) {
    const owner = await findOwnerByLemonSubscriptionId(String(payload.subscriptionId));
    if (owner) return owner;
  }

  if (payload.email) {
    const user = await findOwnerByEmail(payload.email);
    if (!user) return null;
    const ownerId = await findOwnerIdForMember(user.id);
    return findUserById(ownerId || user.id);
  }

  return null;
}

router.get("/plan", async (request, response, next) => {
  try {
    if (!request.session.userId) {
      return response.json({ plan: publicPlan() });
    }

    const ownerId = request.session.ownerUserId || (await findOwnerIdForMember(request.session.userId));
    const owner = ownerId ? await findUserById(ownerId) : null;
    response.json({
      plan: publicPlan({
        plan: owner?.plan,
        status: owner?.planStatus,
        currentPeriodEndsAt: owner?.currentPeriodEndsAt
      })
    });
  } catch (error) {
    next(error);
  }
});

router.post("/dev/plan", async (request, response, next) => {
  try {
    if (config.nodeEnv === "production") {
      return response.status(404).json({ message: "Not found" });
    }

    if (!request.session.userId) {
      return response.status(401).json({ message: "Connect Gmail first" });
    }

    const ownerId = request.session.ownerUserId || (await findOwnerIdForMember(request.session.userId));
    const plan = normalizePlan(request.body?.plan);
    await updateOwnerPlan(ownerId, {
      plan,
      status: plan === "free" ? "free" : "active",
      currentPeriodEndsAt: null
    });

    response.json({ plan: publicPlan({ plan, status: plan === "free" ? "free" : "active" }) });
  } catch (error) {
    next(error);
  }
});

router.post("/lemonsqueezy/webhook", async (request, response, next) => {
  try {
    if (!verifyWebhookSignature(request)) {
      return response.status(401).json({ message: "Invalid Lemon Squeezy signature" });
    }

    const payload = extractSubscriptionPayload(request.body);
    const owner = await findWebhookOwner(payload);
    if (!owner) {
      console.warn("[billing] Lemon Squeezy webhook could not match an owner", {
        eventName: payload.eventName,
        email: payload.email,
        subscriptionId: payload.subscriptionId
      });
      return response.status(202).json({ ok: true, matched: false });
    }

    await updateOwnerPlan(owner.id, {
      plan: planForVariant(payload.variantId, config),
      status: payload.status,
      lemonCustomerId: payload.customerId ? String(payload.customerId) : null,
      lemonSubscriptionId: payload.subscriptionId ? String(payload.subscriptionId) : null,
      lemonVariantId: payload.variantId ? String(payload.variantId) : null,
      currentPeriodEndsAt: mysqlDate(payload.renewsAt)
    });

    response.json({ ok: true, matched: true });
  } catch (error) {
    next(error);
  }
});

export default router;
