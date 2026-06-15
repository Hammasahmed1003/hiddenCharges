import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  FileText,
  Filter,
  Inbox,
  LogOut,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  TrendingUp,
  WalletCards
} from "lucide-react";
import "./styles.css";

const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "http://localhost:4000" : window.location.origin);
const CURRENCY_OPTIONS = [
  { code: "PKR", flag: "🇵🇰", label: "PKR" },
  { code: "USD", flag: "🇺🇸", label: "USD" },
  { code: "EUR", flag: "🇪🇺", label: "EUR" },
  { code: "GBP", flag: "🇬🇧", label: "GBP" },
  { code: "AED", flag: "🇦🇪", label: "AED" },
  { code: "INR", flag: "🇮🇳", label: "INR" }
];
const FEATURE_TABS = [
  { id: "overview", label: "Overview" },
  { id: "savings", label: "Savings Opportunities" },
  { id: "report", label: "Monthly Report" },
  { id: "timeline", label: "Subscription Timeline" }
];

function mergeSubscription(list, subscription) {
  if (!subscription) return list;
  const key = subscription._id || subscription.fingerprint;
  const exists = list.some((item) => (item._id || item.fingerprint) === key);
  if (exists) {
    return list.map((item) => ((item._id || item.fingerprint) === key ? subscription : item));
  }
  return [subscription, ...list];
}

const fallbackSubscriptions = [
  {
    _id: "demo-1",
    merchantName: "Netflix",
    amount: 1100,
    currency: "PKR",
    cadence: "monthly",
    category: "Entertainment",
    nextBillingDate: "2026-07-01",
    lastChargedAt: "2026-06-01",
    confidence: 0.96,
    status: "verified",
    sourceEmail: { sender: "Netflix Billing", subject: "Your Netflix receipt" }
  },
  {
    _id: "demo-2",
    merchantName: "Google One",
    amount: 650,
    currency: "PKR",
    cadence: "monthly",
    category: "Cloud",
    nextBillingDate: "2026-06-27",
    lastChargedAt: "2026-06-13",
    confidence: 0.91,
    status: "verified",
    sourceEmail: { sender: "Google Payments", subject: "Google One subscription payment" }
  },
  {
    _id: "demo-3",
    merchantName: "Canva Pro",
    amount: 1490,
    currency: "PKR",
    cadence: "monthly",
    category: "Productivity",
    nextBillingDate: "2026-06-19",
    lastChargedAt: "2026-06-06",
    confidence: 0.72,
    status: "needs_review",
    sourceEmail: { sender: "Canva", subject: "Your invoice from Canva" }
  }
];

function formatMoney(amount, currency = "PKR") {
  try {
    return new Intl.NumberFormat("en-PK", {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2
    }).format(amount || 0);
  } catch {
    return `${currency || ""} ${Number(amount || 0).toLocaleString("en-PK")}`.trim();
  }
}

function daysUntil(dateValue) {
  const today = new Date();
  const target = new Date(dateValue);
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function dateInCurrentYear(dateValue) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  return date.getFullYear() === new Date().getFullYear();
}

function groupSpendByCurrency(items) {
  const groups = items.reduce((totals, item) => {
    const currency = item.currency || "PKR";
    totals[currency] = (totals[currency] || 0) + Number(item.amount || 0);
    return totals;
  }, {});

  return Object.entries(groups)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount);
}

function convertAmount(amount, fromCurrency, toCurrency, rates) {
  if (fromCurrency === toCurrency) return Number(amount || 0);
  const fromRate = rates?.[fromCurrency];
  const toRate = rates?.[toCurrency];
  if (!fromRate || !toRate) return null;
  return (Number(amount || 0) / fromRate) * toRate;
}

function totalInCurrency(groups, targetCurrency, rates) {
  let hasMissingRate = false;
  const total = groups.reduce((sum, group) => {
    const converted = convertAmount(group.amount, group.currency, targetCurrency, rates);
    if (converted === null) {
      hasMissingRate = true;
      return sum;
    }
    return sum + converted;
  }, 0);

  return hasMissingRate ? null : total;
}

function annualMultiplier(cadence) {
  if (cadence === "weekly") return 52;
  if (cadence === "monthly") return 12;
  if (cadence === "quarterly") return 4;
  if (cadence === "yearly") return 1;
  return null;
}

function subscriptionDrainInsights(items, rates) {
  const verifiedPaid = items.filter(
    (item) =>
      item.status === "verified" &&
      item.paymentState !== "failed" &&
      dateInCurrentYear(item.lastChargedAt)
  );

  const groups = verifiedPaid.reduce((collection, item) => {
    const key = `${item.merchantName}::${item.currency || "PKR"}`;
    const current = collection[key] || {
      key,
      merchantName: item.merchantName,
      currency: item.currency || "PKR",
      category: item.category || "Other",
      totalPaid: 0,
      payments: 0,
      latestAmount: 0,
      latestDate: null,
      cadence: "unknown"
    };
    const itemDate = item.lastChargedAt ? new Date(item.lastChargedAt) : null;
    const isLatest =
      itemDate && (!current.latestDate || itemDate.getTime() >= current.latestDate.getTime());

    current.totalPaid += Number(item.amount || 0);
    current.payments += 1;
    if (isLatest) {
      current.latestAmount = Number(item.amount || 0);
      current.latestDate = itemDate;
      current.cadence = item.cadence || "unknown";
    }
    collection[key] = current;
    return collection;
  }, {});

  return Object.values(groups)
    .map((item) => {
      const multiplier = annualMultiplier(item.cadence);
      const projectedNext12 = multiplier ? item.latestAmount * multiplier : null;
      return {
        ...item,
        projectedNext12,
        totalUsd: convertAmount(item.totalPaid, item.currency, "USD", rates) ?? item.totalPaid
      };
    })
    .sort((a, b) => b.totalUsd - a.totalUsd)
    .slice(0, 3);
}

function verifiedPaidItems(items) {
  return items.filter((item) => item.status === "verified" && item.paymentState !== "failed");
}

function itemAmountInCurrency(item, targetCurrency, rates) {
  return convertAmount(Number(item.amount || 0), item.currency || "PKR", targetCurrency, rates);
}

function monthKey(value) {
  const date = value ? new Date(value) : new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleDateString("en-PK", { month: "long", year: "numeric" });
}

function groupPaymentsByMerchant(items) {
  return items.reduce((groups, item) => {
    const key = `${item.merchantName}::${item.currency || "PKR"}`;
    groups[key] = [...(groups[key] || []), item];
    return groups;
  }, {});
}

function latestPayment(items) {
  return [...items].sort((a, b) => new Date(b.lastChargedAt || 0) - new Date(a.lastChargedAt || 0))[0];
}

function buildSavingsOpportunities(items, rates, targetCurrency) {
  const paid = verifiedPaidItems(items).filter((item) => dateInCurrentYear(item.lastChargedAt));
  const merchantGroups = groupPaymentsByMerchant(paid);
  const opportunities = [];

  Object.values(merchantGroups).forEach((payments) => {
    const latest = latestPayment(payments);
    const multiplier = annualMultiplier(latest?.cadence);
    const latestConverted = latest ? itemAmountInCurrency(latest, targetCurrency, rates) : null;
    if (latest && multiplier && latestConverted !== null) {
      const projected = latestConverted * multiplier;
      opportunities.push({
        id: `drain-${latest.merchantName}-${latest.currency}`,
        type: "Recurring drain",
        title: `${latest.merchantName} may cost ${formatMoney(projected, targetCurrency)} in the next 12 months`,
        merchant: latest.merchantName,
        impact: projected,
        impactLabel: formatMoney(projected, targetCurrency),
        description:
          "This is based on the latest verified recurring charge and billing period. It is a review signal, not a cancellation recommendation.",
        evidence: `${formatMoney(latest.amount, latest.currency)} ${latest.cadence} charge found in ${payments.length} verified payment${payments.length === 1 ? "" : "s"}.`,
        confidence: latest.confidence >= 0.9 ? "High" : "Medium",
        action: "Review whether this plan still earns its place."
      });
    }

    if (payments.length >= 2) {
      const sorted = [...payments].sort(
        (a, b) => new Date(a.lastChargedAt || 0) - new Date(b.lastChargedAt || 0)
      );
      const recent = sorted[sorted.length - 1];
      const previous = sorted.slice(0, -1);
      const previousAverage =
        previous.reduce((sum, item) => sum + Number(item.amount || 0), 0) / previous.length;
      if (previousAverage > 0 && Number(recent.amount || 0) > previousAverage * 1.15) {
        const increase = Number(recent.amount || 0) - previousAverage;
        const increaseConverted = itemAmountInCurrency(
          { ...recent, amount: increase },
          targetCurrency,
          rates
        );
        if (increaseConverted !== null) {
          const multiplier = annualMultiplier(recent.cadence) || 1;
          opportunities.push({
            id: `increase-${recent.merchantName}-${recent.currency}`,
            type: "Price increase",
            title: `${recent.merchantName} looks ${Math.round(((recent.amount - previousAverage) / previousAverage) * 100)}% higher than before`,
            merchant: recent.merchantName,
            impact: increaseConverted * multiplier,
            impactLabel: formatMoney(increaseConverted * multiplier, targetCurrency),
            description:
              "The latest verified charge is noticeably higher than the earlier average for the same merchant and currency.",
            evidence: `Latest ${formatMoney(recent.amount, recent.currency)} vs earlier average ${formatMoney(previousAverage, recent.currency)}.`,
            confidence: "Medium",
            action: "Check whether this was a plan upgrade, tax change, or price increase."
          });
        }
      }
    }
  });

  const recurringByCategory = paid.reduce((groups, item) => {
    if (!annualMultiplier(item.cadence)) return groups;
    const category = item.category || "Other";
    const merchantKey = `${item.merchantName}::${item.currency || "PKR"}`;
    groups[category] = {
      ...(groups[category] || {}),
      [merchantKey]: item
    };
    return groups;
  }, {});

  Object.entries(recurringByCategory).forEach(([category, merchants]) => {
    const merchantItems = Object.values(merchants);
    if (merchantItems.length < 2) return;
    const annualTotal = merchantItems.reduce((sum, item) => {
      const converted = itemAmountInCurrency(item, targetCurrency, rates);
      const multiplier = annualMultiplier(item.cadence) || 0;
      return converted === null ? sum : sum + converted * multiplier;
    }, 0);
    opportunities.push({
      id: `overlap-${category}`,
      type: "Category overlap",
      title: `${merchantItems.length} recurring ${category} tools may overlap`,
      merchant: category,
      impact: annualTotal,
      impactLabel: formatMoney(annualTotal, targetCurrency),
      description:
        "Multiple recurring tools in one category can be normal for work, but this is where forgotten overlap often hides.",
      evidence: merchantItems.map((item) => item.merchantName).join(", "),
      confidence: "Medium",
      action: "Compare usage and keep only the tools still doing clear work."
    });
  });

  items
    .filter((item) => item.status === "verified" && item.paymentState === "failed")
    .slice(0, 3)
    .forEach((item) => {
      opportunities.push({
        id: `failed-${item._id}`,
        type: "Failed payment risk",
        title: `${item.merchantName} had a failed payment`,
        merchant: item.merchantName,
        impact: 0,
        impactLabel: "Risk",
        description:
          "This may not save money directly, but it can prevent service interruption, late fees, or surprise retry charges.",
        evidence: item.sourceEmail?.subject || "Verified failed-payment email",
        confidence: "High",
        action: "Check whether the service is still needed before retrying payment."
      });
    });

  return opportunities
    .filter((item) => item.impact > 0 || item.type === "Failed payment risk")
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 8);
}

function buildMonthlyReport(items, rates, targetCurrency) {
  const today = new Date();
  const currentKey = monthKey(today);
  const previousMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const previousKey = monthKey(previousMonth);
  const paid = verifiedPaidItems(items);
  const current = paid.filter((item) => monthKey(item.lastChargedAt) === currentKey);
  const previous = paid.filter((item) => monthKey(item.lastChargedAt) === previousKey);
  const total = totalInCurrency(groupSpendByCurrency(current), targetCurrency, rates);
  const previousTotal = totalInCurrency(groupSpendByCurrency(previous), targetCurrency, rates);
  const categorySpend = Object.entries(
    current.reduce((groups, item) => {
      const category = item.category || "Other";
      groups[category] = [...(groups[category] || []), item];
      return groups;
    }, {})
  )
    .map(([category, categoryItems]) => ({
      category,
      amount: totalInCurrency(groupSpendByCurrency(categoryItems), targetCurrency, rates) || 0,
      count: categoryItems.length
    }))
    .sort((a, b) => b.amount - a.amount);
  const merchantSpend = Object.values(groupPaymentsByMerchant(current))
    .map((merchantItems) => ({
      merchant: merchantItems[0].merchantName,
      category: merchantItems[0].category || "Other",
      amount: totalInCurrency(groupSpendByCurrency(merchantItems), targetCurrency, rates) || 0,
      count: merchantItems.length
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    label: monthLabel(today),
    total,
    previousTotal,
    count: current.length,
    failedCount: items.filter(
      (item) => item.status === "verified" && item.paymentState === "failed" && monthKey(item.lastChargedAt) === currentKey
    ).length,
    topCategory: categorySpend[0],
    topMerchant: merchantSpend[0],
    categorySpend,
    merchantSpend,
    currency: targetCurrency
  };
}

function buildTimelineGroups(items, rates, targetCurrency) {
  return Object.values(groupPaymentsByMerchant(verifiedPaidItems(items)))
    .map((payments) => {
      const sorted = [...payments].sort(
        (a, b) => new Date(a.lastChargedAt || 0) - new Date(b.lastChargedAt || 0)
      );
      const points = sorted.map((item) => ({
        date: item.lastChargedAt,
        label: item.lastChargedAt
          ? new Date(item.lastChargedAt).toLocaleDateString("en-PK", { month: "short", day: "numeric" })
          : "Unknown",
        amount: itemAmountInCurrency(item, targetCurrency, rates) || 0,
        sourceAmount: Number(item.amount || 0),
        sourceCurrency: item.currency || "PKR"
      }));
      return {
        key: `${payments[0].merchantName}-${payments[0].currency}`,
        merchant: payments[0].merchantName,
        category: payments[0].category || "Other",
        cadence: latestPayment(payments)?.cadence || "unknown",
        total: points.reduce((sum, point) => sum + point.amount, 0),
        latest: points[points.length - 1],
        points
      };
    })
    .filter((group) => group.points.length > 0)
    .sort((a, b) => b.total - a.total);
}

function App() {
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [usingDemo, setUsingDemo] = useState(false);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authNotice, setAuthNotice] = useState("");
  const [scanProgress, setScanProgress] = useState(null);
  const [rates, setRates] = useState({ USD: 1 });
  const [ratesMeta, setRatesMeta] = useState({ stale: true, fetchedAt: null });
  const [selectedCurrency, setSelectedCurrency] = useState("PKR");
  const [activeFeature, setActiveFeature] = useState("overview");
  const socketRef = useRef(null);
  const path = window.location.pathname;

  async function loadMe() {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load auth status");
      const data = await response.json();
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadSubscriptions() {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/subscriptions`, { credentials: "include" });
      if (!response.ok) throw new Error("API unavailable");
      const data = await response.json();
      setSubscriptions(data.subscriptions);
      setUsingDemo(false);
    } catch {
      setSubscriptions(fallbackSubscriptions);
      setUsingDemo(true);
    } finally {
      setLoading(false);
    }
  }

  async function loadRates() {
    try {
      const response = await fetch(`${API_URL}/api/rates/latest`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load rates");
      const data = await response.json();
      setRates(data.rates || { USD: 1 });
      setRatesMeta({ stale: Boolean(data.stale), fetchedAt: data.fetchedAt || null });
    } catch {
      setRates({ USD: 1 });
      setRatesMeta({ stale: true, fetchedAt: null });
    }
  }

  useEffect(() => {
    const gmailStatus = new URLSearchParams(window.location.search).get("gmail");
    if (gmailStatus === "connected") {
      setAuthNotice("Gmail connected. Live scan is starting.");
      window.history.replaceState({}, "", window.location.pathname);
    }
    loadMe();
    loadSubscriptions();
    loadRates();
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    const socket = io(API_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"]
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setAuthNotice("Connected. All verified payment notifications will appear here live.");
    });

    socket.on("scan:ready", () => {
      setSyncing(true);
      setScanProgress({
        message: `Calculating your spendings from this ${new Date().getFullYear()} year so far`,
        current: 0,
        total: 0,
        accepted: 0,
        percent: 3
      });
      socket.emit("scan:start");
    });

    socket.on("scan:already-running", () => {
      setSyncing(true);
      setAuthNotice("Live scan is already running.");
    });

    socket.on("scan-start", (payload) => {
      setSyncing(true);
      setScanProgress({
        message: payload.message,
        current: 0,
        total: 0,
        accepted: 0,
        percent: 4
      });
    });

    socket.on("scan-count", (payload) => {
      setScanProgress((current) => ({
        message: current?.message || "Reading payment emails",
        current: 0,
        total: payload.total || 0,
        accepted: 0,
        percent: payload.total ? 6 : 100
      }));
    });

    socket.on("scan-progress", (payload) => {
      const total = payload.total || 0;
      setScanProgress((current) => ({
        message: current?.message || "Reading payment emails",
        current: payload.current || 0,
        total,
        accepted: payload.accepted || 0,
        percent: total ? Math.max(8, Math.round(((payload.current || 0) / total) * 100)) : 100
      }));
    });

    socket.on("subscription:found", ({ subscription }) => {
      setSubscriptions((current) => mergeSubscription(current, subscription));
      setUsingDemo(false);
    });

    socket.on("live:payment", ({ message }) => {
      setAuthNotice(message || "New verified payment notification detected.");
    });

    socket.on("subscriptions:replace", ({ subscriptions: nextSubscriptions }) => {
      setSubscriptions(nextSubscriptions);
      setUsingDemo(false);
    });

    socket.on("scan-complete", (payload) => {
      setScanProgress((current) => ({
        message: "Scan complete",
        current: payload.total || current?.current || 0,
        total: payload.total || current?.total || 0,
        accepted: payload.accepted || 0,
        percent: 100
      }));
    });

    socket.on("scan:done", ({ imported, visible }) => {
      setSyncing(false);
      setAuthNotice(
        imported
          ? `Live scan complete. ${visible} verified or failed payment item${visible === 1 ? "" : "s"} are visible. New payment notifications will appear here automatically.`
          : "Live scan complete. New payment notifications will appear here automatically."
      );
      window.setTimeout(() => setScanProgress(null), 1600);
    });

    socket.on("scan:error", ({ message }) => {
      setSyncing(false);
      setAuthNotice(message || "Live Gmail scan failed.");
      setScanProgress(null);
    });

    socket.on("disconnect", () => {
      setSyncing(false);
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [user]);

  async function connectGmail() {
    try {
      const response = await fetch(`${API_URL}/api/auth/gmail/url`, { credentials: "include" });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || "Unable to start Gmail connection");
      }
      const data = await response.json();
      window.location.href = data.url;
    } catch (error) {
      alert(error.message);
    }
  }

  async function disconnectGoogle() {
    try {
      await fetch(`${API_URL}/api/auth/disconnect`, {
        method: "POST",
        credentials: "include"
      });
      setUser(null);
      setSubscriptions([]);
      setUsingDemo(false);
      setAuthNotice("");
    } catch {
      alert("Unable to disconnect Google right now.");
    }
  }

  const filteredSubscriptions = useMemo(() => {
    return subscriptions
      .filter((item) => item.status === "verified" || item.paymentState === "failed")
      .filter((item) => {
        const matchesQuery = `${item.merchantName} ${item.category} ${item.sourceEmail?.sender || ""}`
          .toLowerCase()
          .includes(query.toLowerCase());
        const matchesFilter =
          filter === "all" ||
          (filter === "verified" && item.status === "verified") ||
          (filter === "failed" && item.paymentState === "failed");
        const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
        return matchesQuery && matchesFilter && matchesCategory;
      })
      .sort((a, b) => new Date(b.lastChargedAt || 0) - new Date(a.lastChargedAt || 0));
  }, [subscriptions, query, filter, categoryFilter]);

  const stats = useMemo(() => {
    const verifiedPayments = subscriptions.filter(
      (item) =>
        item.status === "verified" &&
        item.paymentState !== "failed" &&
        dateInCurrentYear(item.lastChargedAt)
    );
    const yearlySpend = groupSpendByCurrency(verifiedPayments);
    const failedCount = subscriptions.filter(
      (item) => item.status === "verified" && item.paymentState === "failed"
    ).length;
    const upcomingRenewals = subscriptions.filter(
      (item) =>
        item.status === "verified" &&
        item.nextBillingDate &&
        daysUntil(item.nextBillingDate) >= 0
    );
    const categoryBuckets = verifiedPayments.reduce((groups, item) => {
      const category = item.category || "Other";
      groups[category] = [...(groups[category] || []), item];
      return groups;
    }, {});
    const categorySpend = Object.entries(categoryBuckets)
      .map(([category, items]) => ({
        category,
        groups: groupSpendByCurrency(items),
        convertedTotal: totalInCurrency(groupSpendByCurrency(items), selectedCurrency, rates),
        totalUsd: totalInCurrency(groupSpendByCurrency(items), "USD", rates) || 0
      }))
      .sort((a, b) => b.totalUsd - a.totalUsd);

    return {
      yearlySpend,
      usdTotal: totalInCurrency(yearlySpend, "USD", rates),
      selectedTotal: totalInCurrency(yearlySpend, selectedCurrency, rates),
      paymentCount: verifiedPayments.length,
      failedCount,
      upcomingCount: upcomingRenewals.length,
      upcomingRenewals: [...upcomingRenewals].sort(
        (a, b) => new Date(a.nextBillingDate) - new Date(b.nextBillingDate)
      ),
      categorySpend,
      drainInsights: subscriptionDrainInsights(subscriptions, rates),
      savingsOpportunities: buildSavingsOpportunities(subscriptions, rates, selectedCurrency),
      monthlyReport: buildMonthlyReport(subscriptions, rates, selectedCurrency),
      timelineGroups: buildTimelineGroups(subscriptions, rates, selectedCurrency)
    };
  }, [subscriptions, rates, selectedCurrency]);

  if (path === "/privacy" || path === "/terms") {
    return <LegalPage page={path === "/privacy" ? "privacy" : "terms"} />;
  }

  if (authLoading) {
    return (
      <main className="connect-shell">
        <section className="connect-card">
          <div className="small-loader" />
          <span>Loading HiddenCharges</span>
        </section>
      </main>
    );
  }

  if (!user && !usingDemo) {
    return <ConnectLanding connectGmail={connectGmail} />;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={21} />
          </div>
          <div>
            <strong>HiddenCharges</strong>
            <span>Finance visibility</span>
          </div>
        </div>

        <div className="account-drawer">
          <span className="drawer-label">Connected account</span>
          <strong>{user ? user.email : "No Gmail connected"}</strong>
          <p>{user ? "Live billing inbox monitor is active." : "Connect Gmail to begin scanning."}</p>
          <button className="secondary-button" onClick={connectGmail}>
            <Mail size={17} />
            {user ? "Switch account" : "Connect Gmail"}
          </button>
          {user && (
            <button className="secondary-button" onClick={disconnectGoogle}>
              <LogOut size={17} />
              Disconnect
            </button>
          )}
        </div>

        <div className="account-drawer subtle">
          <span className="drawer-label">Discounts</span>
          <strong>Coming next</strong>
          <p>We will flag duplicate tools, trials, and subscriptions that may be worth cancelling.</p>
        </div>

      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <h1>Dashboard <span className="beta-pill large">Beta</span></h1>
            <p>Verified payments, recurring risk, and upcoming renewals from your Gmail.</p>
          </div>
          <div className="header-actions">
            <button className="secondary-button" onClick={loadSubscriptions}>
              <RefreshCw size={17} />
              Refresh
            </button>
          </div>
        </header>

        {authNotice && (
          <section className="notice-panel">
            <div>
              {syncing ? <RefreshCw size={20} className="spin" /> : <CheckCircle2 size={20} />}
              <span>{authNotice}</span>
            </div>
            {scanProgress && <ProgressBar progress={scanProgress} />}
          </section>
        )}

        <section className="beta-notice">
          <ShieldCheck size={18} />
          <span>
            HiddenCharges is in Beta. We are improving detection, so totals, renewal dates, and
            categories should be treated as approximate.
          </span>
        </section>

        <FeatureSwitcher activeFeature={activeFeature} onChange={setActiveFeature} />

        <section className="feature-view" key={activeFeature}>
          {activeFeature === "overview" && (
            <OverviewFeature
              loading={loading}
              rates={rates}
              ratesMeta={ratesMeta}
              selectedCurrency={selectedCurrency}
              setSelectedCurrency={setSelectedCurrency}
              stats={stats}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
            />
          )}
          {activeFeature === "savings" && (
            <SavingsOpportunitiesView
              opportunities={stats.savingsOpportunities}
              selectedCurrency={selectedCurrency}
            />
          )}
          {activeFeature === "report" && (
            <MonthlyReportView report={stats.monthlyReport} />
          )}
          {activeFeature === "timeline" && (
            <SubscriptionTimelineView groups={stats.timelineGroups} currency={selectedCurrency} />
          )}
        </section>

        <section className="dashboard-band">
          <div className="dashboard-heading">
            <div>
              <h2>Spending history</h2>
              <p>
                {categoryFilter === "all"
                  ? "First-time setup scans from January 2026 to today in the background; new payment emails appear automatically after that."
                  : `Showing ${categoryFilter} payments. New verified payment emails still appear automatically.`}
              </p>
            </div>
          </div>

          <div className="control-row">
            <label className="search-box">
              <Search size={18} />
              <input
                placeholder="Search merchant, category, or sender"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="segmented" aria-label="Filter subscriptions">
              {[
                ["all", "All"],
                ["verified", "Verified"],
                ["failed", "Failed"]
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "active" : ""}
                  onClick={() => setFilter(value)}
                >
                  <Filter size={15} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="content-grid ledger-only">
            <section className="table-panel" aria-label="Detected subscriptions">
              <div className="table-head">
                <span>Merchant</span>
                <span>Paid date</span>
                <span>Amount</span>
                <span>State</span>
              </div>
              {loading ? (
                <TableSkeleton />
              ) : user && filteredSubscriptions.length === 0 && !usingDemo ? (
                <EmptyConnectedState syncing={syncing} />
              ) : filteredSubscriptions.length === 0 ? (
                <div className="empty-state">No subscriptions match this view.</div>
              ) : (
                filteredSubscriptions.map((item) => <SubscriptionRow key={item._id} item={item} />)
              )}
            </section>
          </div>
        </section>
      </section>
    </main>
  );
}

function FeatureSwitcher({ activeFeature, onChange }) {
  return (
    <section className="feature-switcher" aria-label="Dashboard feature sections">
      {FEATURE_TABS.map((tab) => (
        <button
          className={activeFeature === tab.id ? "active" : ""}
          key={tab.id}
          onClick={() => onChange(tab.id)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </section>
  );
}

function OverviewFeature({
  loading,
  rates,
  ratesMeta,
  selectedCurrency,
  setSelectedCurrency,
  stats,
  categoryFilter,
  setCategoryFilter
}) {
  return (
    <>
      <section className="overview-grid">
        {loading ? (
          <OverviewSkeleton />
        ) : (
          <>
            <article className="summary-card primary-summary">
              <div className="panel-header">
                <span>Verified spend by currency</span>
                <ShieldCheck size={18} />
              </div>
              <ConversionSummary
                groups={stats.yearlySpend}
                rates={rates}
                ratesMeta={ratesMeta}
                selectedCurrency={selectedCurrency}
                selectedTotal={stats.selectedTotal}
                usdTotal={stats.usdTotal}
                onSelectCurrency={setSelectedCurrency}
              />
            </article>
            <div className="overview-side">
              <div className="metric-strip">
                <Metric icon={WalletCards} label="Verified payments" value={stats.paymentCount} />
                <Metric icon={AlertTriangle} label="Failed payments" value={stats.failedCount} />
                <Metric icon={CalendarDays} label="Upcoming renewals" value={stats.upcomingCount} />
              </div>
              <aside className="calendar-panel compact-calendar">
                <div className="panel-title">
                  <CalendarDays size={18} />
                  Renewal calendar
                </div>
                <RenewalCalendar subscriptions={stats.upcomingRenewals} compact />
              </aside>
            </div>
          </>
        )}
      </section>

      <section className="category-panel">
        <div className="category-panel-head">
          <div>
            <h2>Category spend</h2>
            <p>Tap a category to filter the ledger.</p>
          </div>
        </div>
        <CategoryChips
          categories={stats.categorySpend}
          filter={categoryFilter}
          onChange={setCategoryFilter}
          rates={rates}
          selectedCurrency={selectedCurrency}
        />
      </section>

      <section className="insight-panel">
        <div className="dashboard-heading">
          <div>
            <h2>Largest subscription drains</h2>
            <p>Where the most money has gone since January 2026, and what recurring plans may cost if left active.</p>
          </div>
        </div>
        {loading ? (
          <TableSkeleton />
        ) : stats.drainInsights.length === 0 ? (
          <div className="empty-state compact">No recurring spend insight yet.</div>
        ) : (
          <div className="drain-grid">
            {stats.drainInsights.map((item) => (
              <SubscriptionDrainCard key={item.key} item={item} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function SavingsOpportunitiesView({ opportunities, selectedCurrency }) {
  const totalImpact = opportunities.reduce((sum, item) => sum + Number(item.impact || 0), 0);
  const highValue = opportunities.filter((item) => item.impact > 0).slice(0, 3);

  return (
    <section className="opportunity-shell">
      <div className="feature-intro opportunity-hero">
        <div>
          <span className="eyebrow">SaaS hook</span>
          <h2>Potential savings opportunities</h2>
          <p>
            HiddenCharges reviews verified charges for recurring drain, category overlap, price
            increases, and failed-payment risk. These are review signals, not guaranteed savings.
          </p>
        </div>
        <div className="impact-meter">
          <span>Annual exposure to review</span>
          <strong>{formatMoney(totalImpact, selectedCurrency)}</strong>
          <small>Based on verified billing emails and detected cadence.</small>
        </div>
      </div>

      <div className="opportunity-grid">
        <article className="opportunity-card focus">
          <div className="panel-title">
            <TrendingUp size={18} />
            What this means
          </div>
          <p>
            This view helps users answer the paid-SaaS question: which subscriptions deserve a
            decision today? It prioritizes repeat charges, overlap, and unusually higher bills so
            the user sees where money may keep leaking.
          </p>
          <div className="opportunity-rules">
            {["Recurring annual exposure", "Duplicate category pressure", "Price increase signals", "Failed payment risk"].map((rule) => (
              <span key={rule}>{rule}</span>
            ))}
          </div>
        </article>

        {highValue.map((item) => (
          <OpportunityCard item={item} key={item.id} />
        ))}
      </div>

      <div className="opportunity-list">
        <div className="dashboard-heading">
          <div>
            <h2>Opportunity queue</h2>
            <p>Each card includes the rule, evidence, confidence, and a practical next action.</p>
          </div>
        </div>
        {opportunities.length === 0 ? (
          <div className="empty-state compact">
            No savings opportunities yet. More verified recurring receipts will make this view stronger.
          </div>
        ) : (
          opportunities.map((item) => <OpportunityRow item={item} key={item.id} />)
        )}
      </div>
    </section>
  );
}

function OpportunityCard({ item }) {
  return (
    <article className="opportunity-card">
      <span className="opportunity-type">{item.type}</span>
      <h3>{item.title}</h3>
      <strong>{item.impactLabel}</strong>
      <p>{item.description}</p>
      <small>{item.evidence}</small>
    </article>
  );
}

function OpportunityRow({ item }) {
  return (
    <article className="opportunity-row">
      <div>
        <span className="opportunity-type">{item.type}</span>
        <strong>{item.title}</strong>
        <p>{item.description}</p>
        <small>Evidence: {item.evidence}</small>
      </div>
      <div className="opportunity-row-side">
        <strong>{item.impactLabel}</strong>
        <span>{item.confidence} confidence</span>
        <small>{item.action}</small>
      </div>
    </article>
  );
}

function MonthlyReportView({ report }) {
  const change =
    report.previousTotal && report.total !== null
      ? ((report.total - report.previousTotal) / report.previousTotal) * 100
      : null;

  return (
    <section className="monthly-report">
      <div className="feature-intro">
        <div>
          <span className="eyebrow">Monthly report</span>
          <h2>{report.label}</h2>
          <p>
            A clean monthly summary of verified billing activity. This version stays inside the
            dashboard; email delivery and PDF export can become paid add-ons later.
          </p>
        </div>
        <div className="report-total">
          <span>Verified spend this month</span>
          <strong>{report.total === null ? "Rates unavailable" : formatMoney(report.total, report.currency)}</strong>
          <small>
            {change === null
              ? "Previous month comparison appears after enough data."
              : `${change >= 0 ? "+" : ""}${Math.round(change)}% vs previous month`}
          </small>
        </div>
      </div>

      <div className="report-grid">
        <Metric icon={WalletCards} label="Payments found" value={report.count} />
        <Metric icon={AlertTriangle} label="Failed payments" value={report.failedCount} />
        <Metric
          icon={Tag}
          label="Top category"
          value={report.topCategory ? report.topCategory.category : "None"}
        />
      </div>

      <div className="report-columns">
        <ReportList
          title="Category breakdown"
          items={report.categorySpend.map((item) => ({
            label: item.category,
            meta: `${item.count} payment${item.count === 1 ? "" : "s"}`,
            amount: formatMoney(item.amount, report.currency)
          }))}
        />
        <ReportList
          title="Top merchants"
          items={report.merchantSpend.slice(0, 6).map((item) => ({
            label: item.merchant,
            meta: item.category,
            amount: formatMoney(item.amount, report.currency)
          }))}
        />
      </div>
    </section>
  );
}

function ReportList({ title, items }) {
  return (
    <article className="report-list">
      <div className="panel-title">
        <FileText size={18} />
        {title}
      </div>
      {items.length === 0 ? (
        <div className="empty-state compact">No verified payments in this view yet.</div>
      ) : (
        items.map((item) => (
          <div className="report-line" key={`${title}-${item.label}`}>
            <div>
              <strong>{item.label}</strong>
              <span>{item.meta}</span>
            </div>
            <strong>{item.amount}</strong>
          </div>
        ))
      )}
    </article>
  );
}

function SubscriptionTimelineView({ groups, currency }) {
  const [selectedKey, setSelectedKey] = useState(groups[0]?.key || "");
  const selected = groups.find((group) => group.key === selectedKey) || groups[0];

  useEffect(() => {
    if (!selectedKey && groups[0]?.key) setSelectedKey(groups[0].key);
    if (selectedKey && groups.length && !groups.some((group) => group.key === selectedKey)) {
      setSelectedKey(groups[0].key);
    }
  }, [groups, selectedKey]);

  return (
    <section className="timeline-shell">
      <div className="feature-intro">
        <div>
          <span className="eyebrow">Subscription timeline</span>
          <h2>See how each subscription changes over time</h2>
          <p>
            The timeline groups verified payments by merchant and plots charge history. It makes
            repeat charges, price jumps, and one-off spikes easier to see at a glance.
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state compact">No verified payment timeline yet.</div>
      ) : (
        <div className="timeline-layout">
          <aside className="timeline-merchant-list">
            {groups.slice(0, 10).map((group) => (
              <button
                className={selected?.key === group.key ? "active" : ""}
                key={group.key}
                onClick={() => setSelectedKey(group.key)}
                type="button"
              >
                <span>{group.merchant}</span>
                <strong>{formatMoney(group.total, currency)}</strong>
              </button>
            ))}
          </aside>
          {selected && <TimelineDetail group={selected} currency={currency} />}
        </div>
      )}
    </section>
  );
}

function TimelineDetail({ group, currency }) {
  const maxAmount = Math.max(...group.points.map((point) => point.amount), 1);
  const width = 520;
  const height = 180;
  const points = group.points.map((point, index) => {
    const x = group.points.length === 1 ? width / 2 : (index / (group.points.length - 1)) * width;
    const y = height - (point.amount / maxAmount) * (height - 28) - 12;
    return { ...point, x, y };
  });
  const pathData = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <article className="timeline-detail">
      <div className="timeline-detail-head">
        <div>
          <h3><BarChart3 size={18} /> {group.merchant}</h3>
          <span>{group.category} · {group.cadence}</span>
        </div>
        <strong>{formatMoney(group.total, currency)}</strong>
      </div>
      <svg className="timeline-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${group.merchant} payment timeline`}>
        <path d={pathData} />
        {points.map((point) => (
          <g key={`${point.label}-${point.amount}`}>
            <circle cx={point.x} cy={point.y} r="5" />
            <text x={point.x} y={height - 2}>{point.label}</text>
          </g>
        ))}
      </svg>
      <div className="timeline-payments">
        {group.points.map((point) => (
          <div className="timeline-payment" key={`${point.date}-${point.sourceAmount}`}>
            <span>{point.label}</span>
            <strong>{formatMoney(point.amount, currency)}</strong>
            <small>{formatMoney(point.sourceAmount, point.sourceCurrency)} original</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <article className="summary-card primary-summary skeleton-card">
        <div className="skeleton-line short" />
        <div className="skeleton-line hero" />
        <div className="skeleton-line medium" />
      </article>
      {[1, 2, 3, 4].map((item) => (
        <div className="metric skeleton-card" key={item}>
          <div className="skeleton-dot" />
          <div className="skeleton-line medium" />
          <div className="skeleton-line strong" />
        </div>
      ))}
    </>
  );
}

function TableSkeleton() {
  return (
    <div className="skeleton-table" aria-label="Loading subscriptions">
      {[1, 2, 3, 4].map((item) => (
        <div className="subscription-row skeleton-row" key={item}>
          <div className="merchant-cell">
            <div className="skeleton-avatar" />
            <div>
              <div className="skeleton-line medium" />
              <div className="skeleton-line wide" />
            </div>
          </div>
          <div className="skeleton-line medium" />
          <div className="skeleton-line medium" />
          <div className="skeleton-pill" />
        </div>
      ))}
    </div>
  );
}

function ProgressBar({ progress }) {
  const percent = Math.min(100, Math.max(0, progress.percent || 0));
  const extractionText =
    percent >= 100
      ? "Payment email extraction complete"
      : `${percent}% payment email extraction in progress`;

  return (
    <div className="scan-progress" role="status" aria-live="polite">
      <div className="progress-meta">
        <span>{progress.message}</span>
        <small>{extractionText}</small>
      </div>
      <p className="progress-subline">
        First time can take some time, but it keeps running safely in the background.
      </p>
      <div className="progress-track" aria-hidden="true">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function RenewalCalendar({ subscriptions, compact = false }) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const leadingBlanks = monthStart.getDay();
  const upcoming = [...subscriptions]
    .filter((item) => item.nextBillingDate && daysUntil(item.nextBillingDate) >= 0)
    .sort((a, b) => new Date(a.nextBillingDate) - new Date(b.nextBillingDate));
  const renewals = upcoming.reduce((groups, item) => {
    const date = new Date(item.nextBillingDate);
    if (date.getFullYear() !== today.getFullYear() || date.getMonth() !== today.getMonth()) {
      return groups;
    }
    const day = date.getDate();
    groups[day] = [...(groups[day] || []), item];
    return groups;
  }, {});
  const cells = [
    ...Array.from({ length: leadingBlanks }, (_, index) => ({
      type: "blank",
      key: `blank-${index}`
    })),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      const date = new Date(today.getFullYear(), today.getMonth(), day);
      const isPast = date < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      return {
        type: isPast ? "past" : "day",
        key: `day-${day}`,
        day,
        renewals: renewals[day] || []
      };
    })
  ];

  return (
    <div className={`calendar-view ${compact ? "compact" : ""}`}>
      <div className="calendar-month">
        {today.toLocaleDateString("en-PK", { month: "long", year: "numeric" })}
      </div>
      <div className="calendar-weekdays">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
          <span key={`${day}-${index}`}>{day}</span>
        ))}
      </div>
      <div className="calendar-grid">
        {cells.map((cell) =>
          cell.type === "blank" || cell.type === "past" ? (
            <span className={`calendar-day ${cell.type}`} key={cell.key} />
          ) : (
            <span
              className={`calendar-day ${cell.renewals.length ? "has-renewal" : ""} ${
                cell.day === today.getDate() ? "today" : ""
              }`}
              key={cell.key}
            >
              {cell.day}
              {cell.renewals.length > 0 && (
                <span className="calendar-tooltip">
                  {cell.renewals.map((item) => (
                    <span className="tooltip-item" key={`${item._id}-tip`}>
                      <strong>{item.merchantName}</strong>
                      <small>{formatMoney(item.amount, item.currency)}</small>
                    </span>
                  ))}
                </span>
              )}
            </span>
          )
        )}
      </div>
      {upcoming.length === 0 && (
        <p className="calendar-empty">No upcoming verified renewals detected.</p>
      )}
    </div>
  );
}

function ConnectLanding({ connectGmail }) {
  return (
    <main className="connect-shell marketing-shell">
      <header className="marketing-nav">
        <div className="brand compact">
          <div className="brand-mark">
            <ShieldCheck size={20} />
          </div>
          <strong>HiddenCharges</strong>
        </div>
        <div className="marketing-links">
          <a href="/privacy">
            Privacy
          </a>
          <a href="/terms">
            Terms
          </a>
          <button className="secondary-button" onClick={connectGmail}>
            <Mail size={17} />
            Connect Gmail
          </button>
        </div>
      </header>

      <section className="connect-hero">
        <div className="connect-copy">
          <span className="eyebrow">Subscription spend intelligence</span>
          <h1>Find the charges hiding inside your inbox.</h1>
          <p>
            HiddenCharges reads verified billing emails and turns them into a private dashboard for
            subscriptions, renewals, failed payments, and yearly spend.
          </p>
          <div className="beta-copy">
            Beta product: financial data shown here is approximate while we improve extraction and
            categorization.
          </div>
          <div className="hero-security">
            <div className="trust-icon">
              <ShieldCheck size={19} />
            </div>
            <div>
              <strong>Secure by design</strong>
              <span>
                Read-only Google access, encrypted connections, and billing-only extraction. We do
                not send, edit, or delete your emails.
              </span>
            </div>
          </div>
          <button className="google-button" onClick={connectGmail}>
            <Mail size={18} />
            Continue with Google
          </button>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="scan-orbit">
            <span />
            <span />
            <span />
          </div>
          <div className="connect-preview">
            <div className="preview-row">
              <span>Verified spend</span>
              <strong>US$58.24</strong>
            </div>
            <div className="preview-row">
              <span>Highest drain</span>
              <strong>Google Play</strong>
            </div>
            <div className="preview-row muted">
              <span>Live notifications</span>
              <strong>Ready</strong>
            </div>
          </div>
          <div className="mini-email-card one">
            <Mail size={16} />
            <span>Receipt found</span>
          </div>
          <div className="mini-email-card two">
            <Sparkles size={16} />
            <span>Charge verified</span>
          </div>
        </div>
      </section>

      <section className="benefit-strip">
        <article>
          <WalletCards size={18} />
          <strong>Total spend clarity</strong>
          <span>See verified spending since 2026 across PKR, USD, and other currencies.</span>
        </article>
        <article>
          <CalendarDays size={18} />
          <strong>Renewal awareness</strong>
          <span>Surface future billing dates when receipts reveal recurring cycles.</span>
        </article>
        <article>
          <Tag size={18} />
          <strong>Cancellation signals</strong>
          <span>Identify the services draining the most money before they keep compounding.</span>
        </article>
      </section>
    </main>
  );
}

function LegalPage({ page }) {
  const isPrivacy = page === "privacy";

  return (
    <main className="marketing-shell legal-shell">
      <header className="marketing-nav">
        <div className="brand compact">
          <div className="brand-mark">
            <ShieldCheck size={20} />
          </div>
          <strong>HiddenCharges</strong>
        </div>
        <button className="secondary-button" onClick={() => { window.location.href = "/"; }}>
          Back
        </button>
      </header>
      <section className="legal-page">
        <span className="eyebrow">{isPrivacy ? "Privacy Policy" : "Terms and Conditions"}</span>
        <h1>{isPrivacy ? "How HiddenCharges handles Gmail, AI, and billing data." : "Terms for using HiddenCharges Beta."}</h1>
        {isPrivacy ? (
          <div className="legal-copy">
            <p>HiddenCharges uses Google OAuth with read-only Gmail permission to find billing, receipt, renewal, refund, and failed-payment emails. We do not request Gmail send access, and we do not modify, delete, forward, or reply to your emails.</p>
            <p>We use automated pre-filters first so obvious non-payment emails are ignored before AI analysis. When AI analysis is needed, HiddenCharges sends only focused billing excerpts and basic email metadata needed to extract charge details, not your full inbox.</p>
            <p>AI processing is used to identify merchant name, amount, currency, charge date, billing period, renewal signals, payment status, category, confidence, and evidence text. Results are approximate while the product is in Beta and should be reviewed by the user.</p>
            <p>We store only the data needed to power your dashboard: your connected account identity, encrypted Google OAuth tokens, extracted verified charge records, currency, dates, category, confidence, and limited source-email evidence. Raw full email bodies are not stored as dashboard records.</p>
            <p>Google OAuth tokens are encrypted before storage, and traffic between your browser, our server, Google, and AI providers uses encrypted HTTPS connections in production. You can disconnect your Google account at any time, which deletes your account data and extracted billing records from HiddenCharges.</p>
            <p>HiddenCharges is designed for billing visibility only. We do not sell personal data, and we do not use your Gmail data for advertising.</p>
          </div>
        ) : (
          <div className="legal-copy">
            <p>HiddenCharges is a Beta financial visibility tool that helps you understand subscription spend and billing activity found in your Gmail. It is not financial, legal, tax, or accounting advice.</p>
            <p>By connecting Gmail, you authorize HiddenCharges to use read-only Google OAuth access to analyze billing-related emails and create a dashboard of verified charges, failed payments, renewals, categories, and spend summaries.</p>
            <p>HiddenCharges uses AI-assisted extraction. We work to improve accuracy, but dashboard totals, renewal dates, currency conversions, categories, and projections are approximate and may contain mistakes. You are responsible for reviewing source billing records before making financial decisions.</p>
            <p>You agree not to use HiddenCharges for unlawful activity, to access another Gmail account without permission, or to rely on the service as the only record of your finances.</p>
            <p>You can disconnect your Google account from the dashboard. Disconnecting removes your HiddenCharges account data and extracted billing records from our system.</p>
            <p>We may change, pause, or improve Beta features as the product evolves, including detection logic, AI providers, currency conversion, and renewal estimates.</p>
          </div>
        )}
        <button className="google-button" onClick={() => { window.location.href = "/"; }}>
          <FileText size={18} />
          Return to HiddenCharges
        </button>
      </section>
    </main>
  );
}

function EmptyConnectedState({ syncing }) {
  return (
    <div className="empty-connected">
      <div className="empty-icon">
        {syncing ? <RefreshCw size={26} className="spin" /> : <Inbox size={26} />}
      </div>
      <h3>{syncing ? "Live scan is running" : "Gmail is connected"}</h3>
      <p>
        {syncing
          ? "First-time scanning may take a little time, but verified payments and failed charges will appear as soon as they are found."
          : "All future verified payment notifications will be displayed here automatically."}
      </p>
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CategoryChips({ categories, filter, onChange, rates, selectedCurrency }) {
  const missingCategoryRate = categories.some((category) => category.convertedTotal === null);
  const total = missingCategoryRate
    ? null
    : categories.reduce((sum, category) => sum + (category.convertedTotal || 0), 0);

  return (
    <div className="category-chips" aria-label="Category spend filters">
      <button className={filter === "all" ? "active" : ""} onClick={() => onChange("all")} type="button">
        All
        <span>{total === null ? "Rates unavailable" : formatMoney(total, selectedCurrency)}</span>
      </button>
      {categories.map((category) => {
        const amount =
          category.convertedTotal ??
          totalInCurrency(category.groups, selectedCurrency, rates);
        return (
          <button
            className={filter === category.category ? "active" : ""}
            key={category.category}
            onClick={() => onChange(category.category)}
            type="button"
          >
            {category.category}
            <span>{amount === null ? "Rates unavailable" : formatMoney(amount, selectedCurrency)}</span>
          </button>
        );
      })}
    </div>
  );
}

function SubscriptionDrainCard({ item }) {
  return (
    <article className="drain-card">
      <div className="drain-card-top">
        <div className="merchant-icon">
          <CreditCard size={18} />
        </div>
        <div>
          <strong>{item.merchantName}</strong>
          <span>{item.category}</span>
        </div>
      </div>
      <div className="drain-amount">
        <span>Paid since 2026</span>
        <strong>{formatMoney(item.totalPaid, item.currency)}</strong>
      </div>
      <div className="drain-facts">
        <span>
          Latest charge <strong>{formatMoney(item.latestAmount, item.currency)}</strong>
        </span>
        <span>
          Payments found <strong>{item.payments}</strong>
        </span>
      </div>
      <div className="drain-projection">
        <Tag size={16} />
        <span>
          {item.projectedNext12
            ? `If not cancelled, estimated next 12 months: ${formatMoney(item.projectedNext12, item.currency)}.`
            : "Recurring projection needs a clear billing period."}
        </span>
      </div>
    </article>
  );
}

function MoneyStack({ groups }) {
  if (!groups.length) {
    return <div className="currency-list empty">No verified spend yet</div>;
  }

  const [primary, ...rest] = groups;

  return (
    <div className="money-stack">
      <div className="big-number">{formatMoney(primary.amount, primary.currency)}</div>
      {rest.length > 0 && (
        <div className="currency-list">
          {rest.slice(0, 3).map((group) => (
            <span key={group.currency}>{formatMoney(group.amount, group.currency)}</span>
          ))}
          {rest.length > 3 && <span>+{rest.length - 3} more currencies</span>}
        </div>
      )}
    </div>
  );
}

function ConversionSummary({
  groups,
  rates,
  ratesMeta,
  selectedCurrency,
  selectedTotal,
  usdTotal,
  onSelectCurrency
}) {
  const canConvert = Boolean(rates?.USD && Object.keys(rates).length > 1);
  const usdLabel = usdTotal === null ? "Rates loading" : formatMoney(usdTotal, "USD");
  const selectedLabel = canConvert && selectedTotal !== null
    ? formatMoney(selectedTotal, selectedCurrency)
    : "Live conversion unavailable";

  return (
    <div className="conversion-summary">
      <div className="conversion-total">
        <span>Total since 2026 in USD</span>
        <strong>{usdLabel}</strong>
      </div>
      <div className="converted-total">
        <span>{selectedCurrency} view</span>
        <strong>{selectedLabel}</strong>
      </div>
      <div className="currency-switcher" aria-label="Convert total currency">
        {CURRENCY_OPTIONS.map((option) => (
          <button
            className={selectedCurrency === option.code ? "active" : ""}
            disabled={!rates?.[option.code]}
            key={option.code}
            onClick={() => onSelectCurrency(option.code)}
            type="button"
          >
            <span aria-hidden="true">{option.flag}</span>
            {option.label}
          </button>
        ))}
      </div>
      <MoneyStack groups={groups} />
      <p>
        Original amounts stay untouched. Conversions use USD-based live rates
        {ratesMeta.stale ? " when available." : "."}
      </p>
    </div>
  );
}

function SubscriptionRow({ item }) {
  const confidence = Math.round((item.confidence || 0) * 100);
  const isFailed = item.paymentState === "failed";

  return (
    <article className={`subscription-row ${isFailed ? "failed-payment" : ""}`}>
      <div className="merchant-cell">
        <div className="merchant-icon">
          {isFailed ? <AlertTriangle size={18} /> : <CreditCard size={18} />}
        </div>
        <div>
          <strong>{item.merchantName}</strong>
          <span>
            {item.category} · {item.sourceEmail?.sender || "Receipt email"}
          </span>
        </div>
      </div>
      <div className="amount-cell">
        <strong>
          {item.lastChargedAt
            ? new Date(item.lastChargedAt).toLocaleDateString("en-PK")
            : "Unknown"}
        </strong>
        <span>{item.cadence}</span>
      </div>
      <div className="date-cell">
        <strong>{isFailed ? "Failed" : formatMoney(item.amount, item.currency)}</strong>
        <span>{item.nextBillingDate ? `${daysUntil(item.nextBillingDate)} days to renewal` : "Renewal unknown"}</span>
      </div>
      <div className="confidence-cell">
        <span className={`status-pill ${isFailed ? "failed" : "verified"}`}>
          {isFailed ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
          {isFailed ? "Failed" : `${confidence}%`}
        </span>
        <small>{isFailed ? "Payment issue" : "Verified"}</small>
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")).render(<App />);
