import { z } from "zod";

const amountPattern =
  /(?:PKR|Rs\.?|USD|US\$|\$|AED|د\.إ|GBP|£|EUR|€|INR|₹|SAR|ر\.س|CAD|C\$|AUD|A\$|SGD|S\$|JPY|¥)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s?(?:PKR|Rs\.?|USD|US\$|\$|AED|د\.إ|GBP|£|EUR|€|INR|₹|SAR|ر\.س|CAD|C\$|AUD|A\$|SGD|S\$|JPY|¥)/i;

const currencyPatterns = [
  [/PKR|Rs\.?/i, "PKR"],
  [/CAD|C\$/i, "CAD"],
  [/AUD|A\$/i, "AUD"],
  [/SGD|S\$/i, "SGD"],
  [/USD|US\$|\$/i, "USD"],
  [/AED|د\.إ/i, "AED"],
  [/GBP|£/i, "GBP"],
  [/EUR|€/i, "EUR"],
  [/INR|₹/i, "INR"],
  [/SAR|ر\.س/i, "SAR"],
  [/JPY|¥/i, "JPY"]
];

const cadencePatterns = [
  [/monthly|per month|every month/i, "monthly"],
  [/yearly|annually|annual|per year/i, "yearly"],
  [/quarterly/i, "quarterly"],
  [/weekly/i, "weekly"]
];

const failedPaymentPattern =
  /failed|declined|couldn'?t process|could not process|payment problem|payment unsuccessful|unable to charge|billing issue|action required/i;

const hardSkipPatterns = [
  /password reset|reset your password|verification code|security alert|new sign-in|login alert|otp|one-time password/i,
  /newsletter|unsubscribe|marketing|promotion|promo code|discount|sale ends|limited time/i,
  /welcome to|getting started|onboarding|confirm your email|verify your email/i,
  /shipped|shipping|delivered|delivery update|tracking number|out for delivery/i,
  /invoice is ready|invoice available|view your invoice|proforma invoice|quote|estimate/i
];

const futureOrTrialSkipPatterns = [
  /trial starts|free trial|trial reminder|card will be charged|will be charged|upcoming charge|upcoming payment|renews on|renewal reminder/i
];

const chargeIntentPatterns = [
  /charged|has been charged|was charged|payment received|payment successful|payment processed/i,
  /receipt|tax invoice|paid invoice|payment confirmation|purchase confirmation/i,
  /subscription payment|renewal payment|auto-renewal|recurring payment/i,
  /refund|refunded|credited back|money returned/i,
  /debited|deducted|paid with|billed to|charged to/i
];

const candidateSchema = z.object({
  merchantName: z.string().min(2),
  amount: z.number().min(0),
  currency: z.string().min(3).max(3),
  cadence: z.enum(["weekly", "monthly", "quarterly", "yearly", "unknown"]),
  category: z.string().min(2),
  nextBillingDate: z.preprocess((value) => value || undefined, z.coerce.date().optional()),
  lastChargedAt: z.preprocess((value) => value || undefined, z.coerce.date().optional()),
  confidence: z.number().min(0).max(1),
  status: z.enum(["verified", "needs_review", "rejected"]),
  evidence: z.array(z.string()).default([]),
  paymentState: z.enum(["paid", "failed"]).default("paid")
});

function merchantFromSender(sender) {
  const withoutEmail = sender.replace(/<.*?>/g, "").trim();
  return withoutEmail.split(/[|(-]/)[0].trim() || "Unknown merchant";
}

function detectCurrency(text) {
  return currencyPatterns.find(([pattern]) => pattern.test(text))?.[1] || "PKR";
}

function detectCadence(text) {
  return cadencePatterns.find(([pattern]) => pattern.test(text))?.[1] || "unknown";
}

export function shouldAnalyzeWithAi({ sourceEmail, text }) {
  const haystack = `${sourceEmail.sender} ${sourceEmail.subject} ${sourceEmail.snippet || ""} ${text}`.slice(
    0,
    9000
  );
  const amountMatch = amountPattern.test(haystack);
  const hasChargeLanguage = chargeIntentPatterns.some((pattern) => pattern.test(haystack));
  const hasFutureOrTrialSkip = futureOrTrialSkipPatterns.some((pattern) => pattern.test(haystack));
  const hasHardSkip = hardSkipPatterns.some((pattern) => pattern.test(haystack));

  if (hasFutureOrTrialSkip) {
    return {
      shouldAnalyze: false,
      reason: "Future charge, renewal reminder, or trial language detected"
    };
  }

  if (hasHardSkip && !hasChargeLanguage) {
    return {
      shouldAnalyze: false,
      reason: "Hard skip pattern without actual charge language"
    };
  }

  if (!amountMatch) {
    return {
      shouldAnalyze: false,
      reason: "No explicit amount or supported currency detected"
    };
  }

  if (!hasChargeLanguage) {
    return {
      shouldAnalyze: false,
      reason: "No completed charge, refund, receipt, or payment confirmation language detected"
    };
  }

  return { shouldAnalyze: true, reason: "Payment amount and charge language detected" };
}

function nextBillingDate(lastChargedAt, cadence) {
  if (cadence === "unknown") return undefined;
  const date = new Date(lastChargedAt);
  if (cadence === "weekly") date.setDate(date.getDate() + 7);
  if (cadence === "monthly") date.setMonth(date.getMonth() + 1);
  if (cadence === "quarterly") date.setMonth(date.getMonth() + 3);
  if (cadence === "yearly") date.setFullYear(date.getFullYear() + 1);
  return date;
}

export function buildDeterministicCandidate({ sourceEmail, text }) {
  const amountMatch = text.match(amountPattern);
  const amount = Number((amountMatch?.[1] || amountMatch?.[2] || "").replaceAll(",", ""));
  const cadence = detectCadence(`${sourceEmail.subject} ${text}`);
  const paymentState = failedPaymentPattern.test(`${sourceEmail.subject} ${text}`)
    ? "failed"
    : "paid";
  const lastChargedAt = sourceEmail.receivedAt;
  const evidence = [
    `Subject: ${sourceEmail.subject}`,
    amountMatch?.[0] ? `Amount pattern: ${amountMatch[0]}` : "",
    cadence !== "unknown" ? `Cadence pattern: ${cadence}` : "",
    paymentState === "failed" ? "Failed payment language detected" : ""
  ].filter(Boolean);

  return {
    merchantName: merchantFromSender(sourceEmail.sender),
    amount: amount || 0,
    currency: detectCurrency(text),
    cadence,
    category: "Uncategorized",
    nextBillingDate: nextBillingDate(lastChargedAt, cadence),
    lastChargedAt,
    confidence: amount || paymentState === "failed" ? (cadence !== "unknown" ? 0.76 : 0.62) : 0.2,
    status: amount || paymentState === "failed" ? "needs_review" : "rejected",
    paymentState,
    evidence,
    sourceEmail
  };
}

export function validateCandidate(candidate) {
  const parsed = candidateSchema.safeParse(candidate);
  if (!parsed.success) return null;

  const value = parsed.data;
  if (value.status === "rejected") return null;

  const hasStrongEvidence =
    value.evidence.length >= 2 && value.confidence >= 0.9;
  const status = value.status === "verified" && hasStrongEvidence ? "verified" : "needs_review";

  return {
    ...value,
    amount: Number(value.amount.toFixed(2)),
    currency: value.currency.toUpperCase(),
    status
  };
}
