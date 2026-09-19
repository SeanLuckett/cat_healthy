import { describe, it, expect } from "vitest";
import { mealSlotLabel } from "./mealSlot";

describe("mealSlotLabel", () => {
  it("labels slot 1 as Breakfast", () => {
    expect(mealSlotLabel(1)).toBe("Breakfast");
  });

  it("labels slot 2 as Lunch", () => {
    expect(mealSlotLabel(2)).toBe("Lunch");
  });

  it("labels slot 3 as Dinner", () => {
    expect(mealSlotLabel(3)).toBe("Dinner");
  });

  it("falls back to Meal N for slots beyond Breakfast/Lunch/Dinner", () => {
    expect(mealSlotLabel(4)).toBe("Meal 4");
  });

  it("falls back to a placeholder for a missing slot", () => {
    expect(mealSlotLabel(null)).toBe("Meal ?");
  });
});
