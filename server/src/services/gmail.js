import crypto from "node:crypto";
import { google } from "googleapis";
import { config } from "../config.js";
import { normalizeReceiptWithAi } from "./receiptAi.js";
import {
  buildDeterministicCandidate,
  shouldAnalyzeWithAi,
  validateCandidate
} from "./receiptRules.js";

function dateForGmailQuery(date) {
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function scanWindowForUser(user) {
  if (user.lastGmailScanAt && user.gmailHistoryId) {
    const since = new Date(user.lastGmailScanAt);
    since.setDate(since.getDate() - 1);
    return {
      mode: "incremental",
      since,
      queryDate: dateForGmailQuery(since)
    };
  }

  const startOfYear = new Date(new Date().getFullYear(), 0, 1);
  return {
    mode: "year_to_date",
    since: startOfYear,
    queryDate: dateForGmailQuery(startOfYear)
  };
}

function gmailQueryForUser(user) {
  const window = scanWindowForUser(user);
  const query = [
    `after:${window.queryDate}`,
    "(",
    "receipt OR invoice OR subscription OR renewal OR payment OR charged OR paid OR bill OR billing OR debited OR deducted OR refund OR refunded OR purchase OR transaction OR auto-renewal OR \"payment confirmation\" OR \"tax invoice\"",
    ")"
  ].join(" ");

  return { ...window, query };
}

function oauthClientForUser(user) {
  const client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
  );
  client.setCredentials(user.gmailTokens);
  return client;
}

function header(headers, name) {
  return headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBody(part) {
  const body = part?.body?.data;
  if (!body) return "";
  return Buffer.from(body.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8");
}

function flattenMessage(payload) {
  const parts = payload.parts || [payload];
  return parts
    .flatMap((part) => (part.parts ? part.parts : part))
    .map(decodeBody)
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .slice(0, 6000);
}

function fingerprintFor(candidate) {
  return crypto
    .createHash("sha256")
    .update(
      [
        candidate.merchantName?.toLowerCase(),
        candidate.amount,
        candidate.currency,
        candidate.lastChargedAt?.toISOString?.() || "",
        candidate.sourceEmail?.gmailMessageId
      ].join("|")
    )
    .digest("hex");
}

async function candidateFromMessage(gmail, messageId) {
  const detail = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full"
  });

  const headers = detail.data.payload.headers || [];
  const sourceEmail = {
    gmailMessageId: detail.data.id,
    threadId: detail.data.threadId,
    sender: header(headers, "from"),
    subject: header(headers, "subject"),
    snippet: detail.data.snippet,
    receivedAt: new Date(Number(detail.data.internalDate))
  };
  const text = flattenMessage(detail.data.payload);
  const deterministic = buildDeterministicCandidate({ sourceEmail, text });
  const prefilter = shouldAnalyzeWithAi({ sourceEmail, text });
  if (!prefilter.shouldAnalyze) {
    return { candidate: null, sourceEmail, skipReason: prefilter.reason };
  }

  const aiCandidate = await normalizeReceiptWithAi({ sourceEmail, text, deterministic });
  const candidate = validateCandidate(aiCandidate || deterministic);

  if (!candidate) {
    return { candidate: null, sourceEmail, skipReason: "AI did not return a verified charge" };
  }

  candidate.sourceEmail = sourceEmail;
  candidate.fingerprint = fingerprintFor(candidate);
  return { candidate, sourceEmail, skipReason: null };
}

async function latestHistoryId(gmail) {
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.historyId ? String(profile.data.historyId) : null;
}

export async function extractSubscriptionsFromGmail(user, progress = {}) {
  const auth = oauthClientForUser(user);
  const gmail = google.gmail({ version: "v1", auth });
  const scan = gmailQueryForUser(user);
  console.log(`[gmail-sync] Starting scan for ${user.email}`);
  console.log(`[gmail-sync] Mode: ${scan.mode}`);
  console.log(`[gmail-sync] Query: ${scan.query}`);
  progress.emit?.("scan-start", {
    mode: scan.mode,
    message:
      scan.mode === "year_to_date"
        ? `Calculating your spendings from this ${new Date().getFullYear()} year so far`
        : "Checking new payment emails since your last scan"
  });

  const messages = [];
  let pageToken;

  do {
    const list = await gmail.users.messages.list({
      userId: "me",
      q: scan.query,
      maxResults: 100,
      pageToken
    });

    messages.push(...(list.data.messages || []));
    pageToken = list.data.nextPageToken;
  } while (pageToken);

  const results = [];
  console.log(`[gmail-sync] Found ${messages.length} candidate Gmail messages`);
  progress.emit?.("scan-count", { total: messages.length });

  for (const [index, message] of messages.entries()) {
    progress.emit?.("scan-progress", {
      current: index + 1,
      total: messages.length,
      accepted: results.length
    });
    const { candidate, sourceEmail, skipReason } = await candidateFromMessage(gmail, message.id);

    if (candidate) {
      candidate.sourceEmail = sourceEmail;
      candidate.fingerprint = fingerprintFor(candidate);
      results.push(candidate);
      await progress.onCandidate?.(candidate, {
        current: index + 1,
        total: messages.length,
        accepted: results.length
      });
      console.log(
        `[gmail-sync] ${index + 1}/${messages.length} accepted: ${candidate.merchantName} ${candidate.currency} ${candidate.amount} (${candidate.status}, ${Math.round(candidate.confidence * 100)}%)`
      );
    } else {
      console.log(
        `[gmail-sync] ${index + 1}/${messages.length} skipped: ${sourceEmail.subject || "No subject"} (${skipReason || "not a verified charge"})`
      );
    }
  }

  const historyId = await latestHistoryId(gmail);
  console.log(`[gmail-sync] Finished. Accepted ${results.length} payment/subscription candidates`);
  progress.emit?.("scan-complete", { total: messages.length, accepted: results.length });
  return { subscriptions: results, historyId };
}

export async function extractNewSubscriptionsFromGmail(user, progress = {}) {
  const auth = oauthClientForUser(user);
  const gmail = google.gmail({ version: "v1", auth });

  if (!user.gmailHistoryId) {
    return { subscriptions: [], historyId: await latestHistoryId(gmail) };
  }

  const messageIds = new Set();
  let pageToken;
  let latestSeenHistoryId = user.gmailHistoryId;

  do {
    const history = await gmail.users.history.list({
      userId: "me",
      startHistoryId: user.gmailHistoryId,
      historyTypes: ["messageAdded"],
      pageToken
    });

    latestSeenHistoryId = history.data.historyId
      ? String(history.data.historyId)
      : latestSeenHistoryId;

    for (const item of history.data.history || []) {
      for (const added of item.messagesAdded || []) {
        if (added.message?.id) messageIds.add(added.message.id);
      }
    }

    pageToken = history.data.nextPageToken;
  } while (pageToken);

  const messages = [...messageIds];
  const results = [];

  if (messages.length > 0) {
    console.log(`[gmail-live] Found ${messages.length} newly added Gmail messages`);
  }

  for (const [index, messageId] of messages.entries()) {
    const { candidate, sourceEmail, skipReason } = await candidateFromMessage(gmail, messageId);

    if (candidate) {
      results.push(candidate);
      await progress.onCandidate?.(candidate, {
        current: index + 1,
        total: messages.length,
        accepted: results.length
      });
      console.log(
        `[gmail-live] ${index + 1}/${messages.length} accepted: ${candidate.merchantName} ${candidate.currency} ${candidate.amount} (${candidate.status}, ${Math.round(candidate.confidence * 100)}%)`
      );
    } else {
      console.log(
        `[gmail-live] ${index + 1}/${messages.length} skipped: ${sourceEmail.subject || "No subject"} (${skipReason || "not a verified charge"})`
      );
    }
  }

  return { subscriptions: results, historyId: latestSeenHistoryId };
}

export async function watchGmailInbox(user) {
  if (!config.google.pubsubTopic) return null;

  const auth = oauthClientForUser(user);
  const gmail = google.gmail({ version: "v1", auth });
  const response = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName: config.google.pubsubTopic,
      labelIds: ["INBOX"]
    }
  });

  return {
    historyId: response.data.historyId ? String(response.data.historyId) : null,
    expiration: response.data.expiration
  };
}
