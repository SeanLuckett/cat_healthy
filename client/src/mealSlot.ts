const MEAL_SLOT_NAMES: Record<number, string> = {
  1: "Breakfast",
  2: "Lunch",
  3: "Dinner",
};

export const mealSlotLabel = (mealSlot: number | null): string => {
  if (mealSlot == null) return "Meal ?";
  return MEAL_SLOT_NAMES[mealSlot] ?? `Meal ${mealSlot}`;
};
