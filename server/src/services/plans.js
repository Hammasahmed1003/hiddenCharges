export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    gmailLimit: 1,
    whatsappAlerts: false
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 6,
    gmailLimit: 3,
    whatsappAlerts: true
  },
  max: {
    id: "max",
    name: "Max",
    price: 15,
    gmailLimit: 5,
    whatsappAlerts: true
  }
};

const ACTIVE_STATUSES = new Set(["active", "on_trial", "trialing", "paid"]);

export function normalizePlan(plan) {
  return PLANS[plan] ? plan : "free";
}

export function planForVariant(variantId, config) {
  const id = String(variantId || "");
  if (id && id === String(config.lemonSqueezy.maxVariantId || "")) return "max";
  if (id && id === String(config.lemonSqueezy.proVariantId || "")) return "pro";
  return "free";
}

export function effectivePlan(plan, status) {
  const normalized = normalizePlan(plan);
  if (normalized === "free") return "free";
  return ACTIVE_STATUSES.has(String(status || "").toLowerCase()) ? normalized : "free";
}

export function publicPlan({ plan = "free", status = "free", currentPeriodEndsAt = null } = {}) {
  const id = effectivePlan(plan, status);
  return {
    ...PLANS[id],
    status: status || (id === "free" ? "free" : "active"),
    currentPeriodEndsAt
  };
}
