import express from "express";
import { google } from "googleapis";
import { config } from "../config.js";
import {
  accountBelongsToOwner,
  deleteUserAccountData,
  ensureOwnerMembership,
  findOwnerIdForMember,
  findUserById,
  linkUserToOwner,
  listAccountsForOwner,
  publicUser,
  upsertGoogleUser
} from "../repositories/users.js";
import { publicPlan } from "../services/plans.js";

const router = express.Router();

function hasGoogleCredentials() {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

function oauthClient() {
  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
}

async function accountPayload(session) {
  if (!session.userId) {
    return { user: null, accounts: [], activeAccountId: null, primaryAccountId: null };
  }

  const activeUser = await findUserById(session.userId);
  if (!activeUser) {
    session.userId = null;
    session.ownerUserId = null;
    return { user: null, accounts: [], activeAccountId: null, primaryAccountId: null };
  }

  let ownerUserId = session.ownerUserId || (await findOwnerIdForMember(activeUser.id));
  if (!ownerUserId) {
    await ensureOwnerMembership(activeUser.id);
    ownerUserId = activeUser.id;
  }

  session.ownerUserId = ownerUserId;
  const ownerUser = await findUserById(ownerUserId);
  const plan = publicPlan({
    plan: ownerUser?.plan,
    status: ownerUser?.planStatus,
    currentPeriodEndsAt: ownerUser?.currentPeriodEndsAt
  });
  const accounts = await listAccountsForOwner(ownerUserId, activeUser.id);
  return {
    user: publicUser(activeUser),
    accounts,
    activeAccountId: activeUser.id,
    primaryAccountId: accounts.find((account) => account.isPrimary)?.id || ownerUserId,
    plan
  };
}

router.get("/gmail/url", async (request, response, next) => {
  try {
    if (!hasGoogleCredentials()) {
      return response.status(400).json({ message: "Google OAuth credentials are not configured" });
    }

    const mode = request.query.mode === "add" ? "add" : "login";
    request.session.oauthMode = mode;
    request.session.pendingOwnerUserId =
      mode === "add" ? request.session.ownerUserId || request.session.userId || null : null;

    if (mode === "add" && request.session.pendingOwnerUserId) {
      const ownerUser = await findUserById(request.session.pendingOwnerUserId);
      const plan = publicPlan({
        plan: ownerUser?.plan,
        status: ownerUser?.planStatus,
        currentPeriodEndsAt: ownerUser?.currentPeriodEndsAt
      });
      const accounts = await listAccountsForOwner(
        request.session.pendingOwnerUserId,
        request.session.userId
      );
      if (accounts.length >= plan.gmailLimit) {
        return response.status(403).json({
          message: `${plan.name} supports ${plan.gmailLimit} Gmail account${plan.gmailLimit === 1 ? "" : "s"}. Upgrade to connect more.`
        });
      }
    }

    const client = oauthClient();
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile"
      ]
    });

    response.json({ url });
  } catch (error) {
    next(error);
  }
});

router.get("/me", async (request, response, next) => {
  try {
    response.json(await accountPayload(request.session));
  } catch (error) {
    next(error);
  }
});

router.post("/switch-account", async (request, response, next) => {
  try {
    if (!request.session.userId) {
      return response.status(401).json({ message: "Connect Gmail first" });
    }

    const ownerUserId = request.session.ownerUserId || (await findOwnerIdForMember(request.session.userId));
    const accountId = Number(request.body?.accountId);
    if (!ownerUserId || !accountId || !(await accountBelongsToOwner(ownerUserId, accountId))) {
      return response.status(403).json({ message: "This Gmail is not connected to your account" });
    }

    request.session.ownerUserId = ownerUserId;
    request.session.userId = accountId;
    response.json(await accountPayload(request.session));
  } catch (error) {
    next(error);
  }
});

router.get("/gmail/callback", async (request, response, next) => {
  try {
    if (!hasGoogleCredentials()) {
      return response.redirect(`${config.clientUrl}?gmail=missing_credentials`);
    }

    if (request.query.error) {
      return response.redirect(
        `${config.clientUrl}?gmail=error&reason=${encodeURIComponent(request.query.error)}`
      );
    }

    if (!request.query.code) {
      return response.redirect(`${config.clientUrl}?gmail=missing_code`);
    }

    const client = oauthClient();
    const { tokens } = await client.getToken(request.query.code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const profile = await oauth2.userinfo.get();

    const user = await upsertGoogleUser({
      email: profile.data.email,
      name: profile.data.name,
      googleId: profile.data.id,
      gmailTokens: tokens
    });

    const requestedOwnerId = request.session.pendingOwnerUserId;
    if (request.session.oauthMode === "add" && requestedOwnerId) {
      await linkUserToOwner(requestedOwnerId, user.id);
      request.session.ownerUserId = requestedOwnerId;
      request.session.userId = user.id;
    } else {
      let ownerUserId = await findOwnerIdForMember(user.id);
      if (!ownerUserId) {
        await ensureOwnerMembership(user.id);
        ownerUserId = user.id;
      }
      request.session.ownerUserId = ownerUserId;
      request.session.userId = user.id;
    }

    request.session.oauthMode = null;
    request.session.pendingOwnerUserId = null;
    response.redirect(`${config.clientUrl}?gmail=connected`);
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (request, response) => {
  request.session.destroy(() => {
    response.json({ ok: true });
  });
});

router.post("/disconnect", async (request, response, next) => {
  try {
    if (request.session.userId) {
      const ownerUserId = request.session.ownerUserId || (await findOwnerIdForMember(request.session.userId));
      const accounts = ownerUserId ? await listAccountsForOwner(ownerUserId, request.session.userId) : [];
      const accountIds = accounts.length ? accounts.map((account) => account.id) : [request.session.userId];
      for (const accountId of accountIds) {
        await deleteUserAccountData(accountId);
      }
    }

    request.session.destroy(() => {
      response.json({ ok: true });
    });
  } catch (error) {
    next(error);
  }
});

export default router;
