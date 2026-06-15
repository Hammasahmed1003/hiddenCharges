import OpenAI from "openai";
import { config } from "../config.js";

const systemPrompt = `
You are a world-class financial data extraction AI specialized in analyzing billing and payment emails.

Your job is to extract charge information from emails with maximum accuracy.
You must NEVER guess, assume, or hallucinate financial data.

STRICT RULES:
1. REAL CHARGES ONLY
Only extract if money actually left the user's account.
Ignore quotes, estimates, upcoming charges, free trials, marketing emails, order processing emails,
shipping emails, and "your invoice is ready" emails without actual charge confirmation.

2. EXACT AMOUNTS ONLY
Amount must appear explicitly in the email.
Never calculate, estimate, infer, or assume.
If multiple amounts appear, use the TOTAL actually charged to the user's payment method.

3. REFUNDS ARE VALID
If money was returned to the user, extract it, set is_refund true, and keep amount as a positive number.

4. DATE ACCURACY
Use the actual charge date from email content.
Do not use the email received date unless the email does not state a separate charge date.
If only month and year are shown, use the 1st of that month.

5. CONFIDENCE SCORING
Be brutally honest.
90-100: Certain. All important fields are clearly stated.
70-89: Mostly sure, but something is slightly unclear.
50-69: Some charge signals, but key information is ambiguous.
0-49: Likely not a charge email or required data is missing.
Never return confidence above 90 if any field is uncertain.

6. CURRENCY DETECTION
Use ISO 4217 codes.
$ = USD unless the email explicitly says another dollar currency.
£ = GBP, € = EUR, ₹ = INR, Rs/PKR = PKR, A$ = AUD, C$ = CAD, S$ = SGD.
If currency is genuinely unclear, use "UNKNOWN".

7. SERVICE NAME
Use the official company/product name, not the sender email address.
If genuinely unclear, use the sender domain name.

8. ALWAYS SKIP
Password resets, welcome/onboarding emails, newsletters, marketing, invoice-ready emails without actual charge,
bank OTP/security alerts, shipping/delivery updates, zero-amount emails that are not true refund records,
promotional discount emails, and future "your card will be charged" emails.

CATEGORIES, pick exactly one:
SaaS, Development, Entertainment, Marketing, Cloud, Design, Productivity, Finance, Shopping, Education, Other.

Return ONLY this exact JSON object shape:
{
  "is_charge_email": true,
  "skip_reason": null,
  "service_name": "Exact company or product name",
  "amount": 0.00,
  "currency": "USD",
  "charge_date": "YYYY-MM-DD",
  "billing_period": "monthly",
  "is_recurring": true,
  "is_refund": false,
  "is_trial": false,
  "category": "SaaS",
  "confidence": 0,
  "confidence_reason": "one sentence explaining confidence",
  "extracted_amount_text": "exact text from email where amount was found"
}

Allowed billing_period values: "monthly", "yearly", "one-time", "unknown".
If is_charge_email is false: set amount to 0, confidence to 0, all other fields to null,
and fill skip_reason with one clear sentence.
No markdown. No extra fields. No explanation outside JSON.
`;

function normalizeBillingPeriod(period) {
  if (period === "monthly" || period === "yearly") return period;
  return "unknown";
}

function mapAiChargeToCandidate(aiCharge, sourceEmail) {
  if (!aiCharge?.is_charge_email) return null;
  if (aiCharge.currency === "UNKNOWN") return null;

  const confidence = Math.max(0, Math.min(1, Number(aiCharge.confidence || 0) / 100));
  const isVerified =
    confidence >= 0.9 &&
    aiCharge.service_name &&
    Number(aiCharge.amount) > 0 &&
    aiCharge.currency &&
    aiCharge.charge_date &&
    aiCharge.extracted_amount_text;

  return {
    merchantName: aiCharge.service_name,
    amount: Number(aiCharge.amount || 0),
    currency: String(aiCharge.currency || "").toUpperCase(),
    cadence: normalizeBillingPeriod(aiCharge.billing_period),
    category: aiCharge.category || "Other",
    nextBillingDate: null,
    lastChargedAt: aiCharge.charge_date,
    confidence,
    status: isVerified ? "verified" : "needs_review",
    paymentState: "paid",
    evidence: [
      aiCharge.extracted_amount_text ? `Amount text: ${aiCharge.extracted_amount_text}` : "",
      aiCharge.confidence_reason ? `Confidence: ${aiCharge.confidence_reason}` : "",
      aiCharge.is_refund ? "Refund record" : "",
      aiCharge.is_trial ? "Trial record" : "",
      aiCharge.is_recurring === true ? "Recurring charge" : ""
    ].filter(Boolean),
    sourceEmail
  };
}

function redactLowValueIdentifiers(text) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[card-number]");
}

function focusedBillingExcerpt(text) {
  const patterns = [
    /(?:PKR|Rs\.?|USD|US\$|\$|AED|GBP|£|EUR|€|INR|₹|SAR|CAD|C\$|AUD|A\$|SGD|S\$|JPY|¥)\s?[0-9][0-9,]*(?:\.[0-9]{1,2})?/gi,
    /[0-9][0-9,]*(?:\.[0-9]{1,2})?\s?(?:PKR|Rs\.?|USD|US\$|\$|AED|GBP|£|EUR|€|INR|₹|SAR|CAD|C\$|AUD|A\$|SGD|S\$|JPY|¥)/gi,
    /charged|payment successful|payment received|payment processed|receipt|tax invoice|paid invoice|refund|refunded|debited|deducted|billed to/gi
  ];
  const windows = [];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index || 0;
      const start = Math.max(0, index - 420);
      const end = Math.min(text.length, index + 620);
      windows.push(text.slice(start, end));
    }
  }

  const excerpt = [...new Set(windows)]
    .join("\n---\n")
    .replace(/\s+/g, " ")
    .slice(0, 3200);

  return redactLowValueIdentifiers(excerpt || text.slice(0, 1600));
}

export async function normalizeReceiptWithAi({ sourceEmail, text, deterministic }) {
  if (!config.openai.apiKey) return null;

  const { sourceEmail: _sourceEmail, ...deterministicWithoutSource } = deterministic || {};
  const billingExcerpt = focusedBillingExcerpt(text);
  const client = new OpenAI({ apiKey: config.openai.apiKey });
  const response = await client.chat.completions.create({
    model: config.openai.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          `From: ${sourceEmail.sender}`,
          `Subject: ${sourceEmail.subject}`,
          `Date Received: ${sourceEmail.receivedAt?.toISOString?.() || sourceEmail.receivedAt}`,
          "Focused billing excerpts:",
          billingExcerpt,
          "",
          "Deterministic pre-read:",
          JSON.stringify(deterministicWithoutSource)
        ].join("\n")
      }
    ]
  });

  try {
    return mapAiChargeToCandidate(JSON.parse(response.choices[0].message.content), sourceEmail);
  } catch {
    return null;
  }
}
