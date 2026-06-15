import express from "express";
import { google } from "googleapis";
import { config } from "../config.js";
import { deleteUserAccountData, findUserById, upsertGoogleUser } from "../repositories/users.js";

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

router.get("/gmail/url", (_request, response) => {
  if (!hasGoogleCredentials()) {
    return response.status(400).json({ message: "Google OAuth credentials are not configured" });
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
});

router.get("/me", async (request, response, next) => {
  try {
    if (!request.session.userId) {
      return response.json({ user: null });
    }

    const user = await findUserById(request.session.userId);
    response.json({
      user: user
        ? {
            email: user.email,
            name: user.name,
            gmailConnected: Boolean(user.gmailTokens?.access_token || user.gmailTokens?.refresh_token)
          }
        : null
    });
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

    request.session.userId = user.id;
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
      await deleteUserAccountData(request.session.userId);
    }

    request.session.destroy(() => {
      response.json({ ok: true });
    });
  } catch (error) {
    next(error);
  }
});

export default router;
