const CACHE_TTL_MS = 1000 * 60 * 60;
const SUPPORTED_CURRENCIES = ["USD", "PKR", "EUR", "GBP", "AED", "INR", "SAR", "CAD", "AUD", "SGD", "JPY"];

let cachedRates = null;

function fallbackRates() {
  return {
    base: "USD",
    rates: { USD: 1 },
    fetchedAt: new Date().toISOString(),
    stale: true
  };
}

export async function latestUsdRates() {
  if (cachedRates && Date.now() - cachedRates.cachedAt < CACHE_TTL_MS) {
    return cachedRates.payload;
  }

  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!response.ok) throw new Error(`Exchange rate API returned ${response.status}`);

    const data = await response.json();
    const rates = SUPPORTED_CURRENCIES.reduce((selected, currency) => {
      if (typeof data.rates?.[currency] === "number") {
        selected[currency] = data.rates[currency];
      }
      return selected;
    }, {});

    const payload = {
      base: "USD",
      rates: { USD: 1, ...rates },
      fetchedAt: data.time_last_update_utc || new Date().toISOString(),
      stale: false
    };

    cachedRates = {
      cachedAt: Date.now(),
      payload
    };

    return payload;
  } catch (error) {
    console.warn(`[rates] Falling back without live rates: ${error.message}`);
    return fallbackRates();
  }
}
