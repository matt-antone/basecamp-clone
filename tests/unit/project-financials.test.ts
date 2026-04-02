import { describe, expect, it } from "vitest";

import {
  calculateExpenseSubtotalUsd,
  calculateHoursLineCostUsd,
  calculateHoursSubtotalUsd,
  calculateProjectExpensesTotalUsd,
  roundUsdHalfUp
} from "@/lib/project-financials";

describe("project financial helpers", () => {
  it("rounds USD values half-up to two decimals", () => {
    expect(roundUsdHalfUp(10.004)).toBe(10);
    expect(roundUsdHalfUp(10.005)).toBe(10.01);
    expect(roundUsdHalfUp(10.015)).toBe(10.02);
  });

  it("calculates line costs and hours subtotals (hours USD is not part of project expense total)", () => {
    expect(calculateHoursLineCostUsd("1.335", "150.00")).toBe(200.25);
    expect(
      calculateHoursSubtotalUsd(
        [
          { hours: "1.335" },
          { hours: 2 }
        ],
        "150.00"
      )
    ).toBe(500.25);
    expect(
      calculateExpenseSubtotalUsd([
        { amount: "45.10" },
        { amount: 12.345 }
      ])
    ).toBe(57.45);
    expect(calculateProjectExpensesTotalUsd([{ amount: "45.10" }, { amount: 12.345 }])).toBe(57.45);
    expect(
      calculateProjectExpensesTotalUsd([{ amount: "45.10" }, { amount: 12.345 }])
    ).toBe(calculateExpenseSubtotalUsd([{ amount: "45.10" }, { amount: 12.345 }]));
    expect(calculateProjectExpensesTotalUsd([])).toBe(0);
  });
});
