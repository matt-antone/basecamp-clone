export const DEFAULT_HOURLY_RATE_USD = 150;
export const MAX_SITE_HOURLY_RATE_USD = 999999.99;
export const MAX_EXPENSE_LINE_AMOUNT_USD = 9999999999.99;

function toFiniteNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function roundUsdHalfUp(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  return sign * (Math.round((absolute + Number.EPSILON) * 100) / 100);
}

export function normalizeHourlyRateUsd(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return DEFAULT_HOURLY_RATE_USD;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_HOURLY_RATE_USD;
  }

  return roundUsdHalfUp(parsed);
}

export function calculateHoursLineCostUsd(hours: number | string | null | undefined, hourlyRateUsd: number | string | null | undefined) {
  return roundUsdHalfUp(toFiniteNumber(hours) * normalizeHourlyRateUsd(hourlyRateUsd));
}

export function calculateHoursSubtotalUsd(
  entries: Array<{ hours: number | string | null | undefined }>,
  hourlyRateUsd: number | string | null | undefined
) {
  return roundUsdHalfUp(entries.reduce((sum, entry) => sum + calculateHoursLineCostUsd(entry.hours, hourlyRateUsd), 0));
}

export function calculateExpenseSubtotalUsd(entries: Array<{ amount: number | string | null | undefined }>) {
  return roundUsdHalfUp(entries.reduce((sum, entry) => sum + toFiniteNumber(entry.amount), 0));
}

/** Project page bottom-line total: expenses only (hours-derived USD is excluded). */
export function calculateProjectExpensesTotalUsd(expenseEntries: Array<{ amount: number | string | null | undefined }>) {
  return calculateExpenseSubtotalUsd(expenseEntries);
}

export function formatUsdMoney(value: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(roundUsdHalfUp(toFiniteNumber(value)));
}

export function formatUsdInput(value: number | string | null | undefined) {
  return roundUsdHalfUp(toFiniteNumber(value)).toFixed(2);
}
