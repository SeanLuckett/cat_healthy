import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TodayScreen from "./TodayScreen";
import type { Food, FeedingEvent, StatusResponse } from "../../../shared/types";

const foods: Food[] = [
  { id: 1, name: "Chicken Pate", kcal_per_gram: 1.2, category: "wet", notes: null, archived: false },
  { id: 2, name: "Kibble", kcal_per_gram: 3.5, category: "dry", notes: null, archived: false },
];

const churu: Food = { id: 3, name: "Churu", kcal_per_gram: 0.43, category: "treat", notes: null, archived: false };

const baseStatus: StatusResponse = {
  dailyTargetKcal: 250,
  belowSafeFloor: false,
  remainingKcal: 120,
  feedingsLeftToday: 2,
  suggestedGramsPerFood: { 1: 45.5, 2: 15, 3: 140 },
  weeklyLossRate: null,
  weeklyLossRateMargin: null,
  progressFlag: null,
  smoothedWeightKg: 5.1,
  currentWeightKg: 5.1,
};

interface MockOptions {
  status?: Partial<StatusResponse>;
  postFeedingResponse?: { ok: boolean; body: unknown };
  deleteFeedingResponse?: { ok: boolean; body: unknown };
  feedingEvents?: FeedingEvent[];
  foods?: Food[];
}

const mockApi = ({
  status: statusOverride = {},
  postFeedingResponse,
  deleteFeedingResponse,
  feedingEvents = [],
  foods: foodsOverride = foods,
}: MockOptions = {}) => {
  const status = { ...baseStatus, ...statusOverride };
  const reply = (ok: boolean, body: unknown) =>
    Promise.resolve({ ok, json: async () => body } as Response);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/foods") return reply(true, foodsOverride);
      if (url === "/api/feedings" && init?.method === "POST") {
        const result = postFeedingResponse ?? { ok: true, body: { ...status, feedingId: 99 } };
        return reply(result.ok, result.body);
      }
      if (url.startsWith("/api/feedings/") && init?.method === "DELETE") {
        const result = deleteFeedingResponse ?? { ok: true, body: status };
        return reply(result.ok, result.body);
      }
      if (url === "/api/feedings") return reply(true, feedingEvents);
      if (url === "/api/status") return reply(true, status);
      throw new Error(`Unhandled fetch: ${url}`);
    }),
  );
  return status;
};

const renderLoaded = async () => {
  render(<TodayScreen />);
  await screen.findByRole("group", { name: "Food" });
  return userEvent.setup();
};

const foodChip = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
const gramsInput = () => screen.getByLabelText("Grams");
const kindButton = (name: "Meal" | "Treat" | "Put back") =>
  within(screen.getByRole("group", { name: "Entry type" })).getByRole("button", { name });
const tapKeys = async (user: ReturnType<typeof userEvent.setup>, keys: string) => {
  for (const k of keys) await user.click(screen.getByRole("button", { name: k }));
};
const lcdMeta = () => gramsInput().closest(".lcd")!.querySelector(".meta")!;
const postCalls = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => init?.method === "POST");

describe("TodayScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state before status arrives, then the budget", async () => {
    mockApi();
    render(<TodayScreen />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();

    const budget = await screen.findByRole("region", { name: "Today's budget" });
    expect(within(budget).getByText("120")).toBeInTheDocument();
    expect(within(budget).getByText("250 kcal")).toBeInTheDocument();
    expect(within(budget).getByText("130 kcal")).toBeInTheDocument(); // eaten
    expect(within(budget).getByText("2")).toBeInTheDocument(); // meals left
  });

  it("shows the server error when status can't be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({ ok: false, json: async () => ({ error: "cat_profile has no row yet" }) } as Response),
      ),
    );
    render(<TodayScreen />);

    expect(await screen.findByText("cat_profile has no row yet")).toBeInTheDocument();
  });

  it("selects the first food and shows its next serving", async () => {
    mockApi();
    await renderLoaded();

    expect(foodChip("Chicken Pate")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Next serving 45.5 g" })).toBeInTheDocument();
  });

  it("leaves archived foods out of the picker and the default selection", async () => {
    const withArchived: Food[] = [
      { id: 4, name: "Old Treat", kcal_per_gram: 0.6, category: "treat", notes: null, archived: true },
      ...foods,
    ];
    mockApi({ foods: withArchived });
    await renderLoaded();

    const picker = within(screen.getByRole("group", { name: "Food" }));
    expect(picker.getAllByRole("button")).toHaveLength(2);
    expect(picker.queryByText("Old Treat")).not.toBeInTheDocument();
    expect(foodChip("Chicken Pate")).toHaveAttribute("aria-pressed", "true");
  });

  it("updates the next serving and rest of today when a different food is picked", async () => {
    mockApi();
    const user = await renderLoaded();
    expect(screen.getByRole("button", { name: "Rest of today 100.0 g" })).toBeInTheDocument();

    await user.click(foodChip("Kibble"));

    expect(foodChip("Kibble")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Next serving 15.0 g" })).toBeInTheDocument();
    // 120 kcal / 3.5 kcal/g ≈ 34.3 g
    expect(screen.getByRole("button", { name: "Rest of today 34.3 g" })).toBeInTheDocument();
  });

  it("switches to Treat when a treat food is picked, and back for a meal food", async () => {
    mockApi({ foods: [...foods, churu] });
    const user = await renderLoaded();

    await user.click(foodChip("Churu"));
    expect(kindButton("Treat")).toHaveAttribute("aria-pressed", "true");

    await user.click(foodChip("Kibble"));
    expect(kindButton("Meal")).toHaveAttribute("aria-pressed", "true");
  });

  it("fills the grams when a quick pick is tapped", async () => {
    mockApi();
    const user = await renderLoaded();

    await user.click(screen.getByRole("button", { name: "Next serving 45.5 g" }));
    expect(gramsInput()).toHaveValue("45.5");

    await user.click(screen.getByRole("button", { name: "Rest of today 100.0 g" }));
    expect(gramsInput()).toHaveValue("100");
  });

  it("hides the next serving when there are no feedings left, but keeps the rest of today", async () => {
    mockApi({ status: { feedingsLeftToday: 0, suggestedGramsPerFood: { 1: null, 2: null } } });
    await renderLoaded();

    expect(screen.getByRole("button", { name: "Rest of today 100.0 g" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Next serving/ })).not.toBeInTheDocument();
  });

  it("hides the rest of today once the budget is used up", async () => {
    mockApi({ status: { remainingKcal: -5, suggestedGramsPerFood: { 1: null, 2: null } } });
    await renderLoaded();

    expect(within(screen.getByRole("region", { name: "Today's budget" })).getByText("-5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rest of today/ })).not.toBeInTheDocument();
  });

  it("offers no quick picks when putting food back", async () => {
    mockApi();
    const user = await renderLoaded();

    await user.click(kindButton("Put back"));
    expect(screen.queryByRole("button", { name: /Next serving|Rest of today/ })).not.toBeInTheDocument();
  });

  it.each([
    ["too_fast", "Losing too fast"],
    ["reversing", "Gaining weight"],
    ["stalled", "Progress stalled"],
  ] as const)("shows a %s banner", async (progressFlag, title) => {
    mockApi({ status: { progressFlag, weeklyLossRate: 0.03 } });
    await renderLoaded();

    const banner = screen.getByRole("alert");
    expect(within(banner).getByText(title)).toBeInTheDocument();
    expect(within(banner).getByText("3.0%/week")).toBeInTheDocument();
  });

  it("shows no banner when progressFlag is null", async () => {
    mockApi();
    await renderLoaded();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns when today's target is below the safe calorie floor", async () => {
    mockApi({ status: { belowSafeFloor: true } });
    await renderLoaded();

    expect(screen.getByText("Below safe calorie floor")).toBeInTheDocument();
  });

  describe("grams entry", () => {
    it("builds the number from keypad taps", async () => {
      mockApi();
      const user = await renderLoaded();

      await tapKeys(user, "0");
      await tapKeys(user, "45.67");
      // Leading zero dropped, one decimal place kept.
      expect(gramsInput()).toHaveValue("45.6");

      await user.click(screen.getByRole("button", { name: "Delete digit" }));
      await user.click(screen.getByRole("button", { name: "Delete digit" }));
      expect(gramsInput()).toHaveValue("45");
    });

    it("cleans up typed input", async () => {
      mockApi();
      const user = await renderLoaded();

      await user.type(gramsInput(), "12a,34");
      expect(gramsInput()).toHaveValue("12.3");
    });
  });

  describe("kcal preview", () => {
    it("shows what's left today until grams are entered", async () => {
      mockApi();
      await renderLoaded();

      expect(lcdMeta()).toHaveTextContent("—120 kcal left");
      expect(screen.getByRole("button", { name: "Enter grams" })).toBeDisabled();
    });

    it("shows the kcal for a meal and what's left after", async () => {
      mockApi();
      const user = await renderLoaded();

      await tapKeys(user, "30");
      // Chicken Pate is 1.2 kcal/g: 30 g = 36 kcal, 120 - 36 = 84 left.
      expect(lcdMeta()).toHaveTextContent("36 kcalleaves 84 kcal");
    });

    it("shows the kcal for a treat", async () => {
      mockApi();
      const user = await renderLoaded();

      await user.click(kindButton("Treat"));
      await tapKeys(user, "5");
      expect(lcdMeta()).toHaveTextContent("6 kcalleaves 114 kcal");
    });

    it("shows put-back grams as kcal given back to today's budget", async () => {
      mockApi();
      const user = await renderLoaded();

      await user.click(kindButton("Put back"));
      await tapKeys(user, "7");
      // 7 g = 8.4 kcal given back: 120 + 8.4 ≈ 128.
      expect(lcdMeta()).toHaveTextContent("8 kcalback to 128 kcal left");
    });

    it("uses the selected food's kcal per gram", async () => {
      mockApi();
      const user = await renderLoaded();

      await user.click(foodChip("Kibble"));
      await tapKeys(user, "10");
      expect(lcdMeta()).toHaveTextContent("35 kcalleaves 85 kcal");
    });

    it("flags an entry that would go over today's budget", async () => {
      mockApi();
      const user = await renderLoaded();

      await tapKeys(user, "110");
      // 110 g = 132 kcal, 12 more than the 120 remaining.
      expect(lcdMeta()).toHaveTextContent("132 kcal12 kcal over budget");
    });
  });

  it("logs a meal, clears the grams, and confirms", async () => {
    mockApi({ postFeedingResponse: { ok: true, body: { ...baseStatus, remainingKcal: 60, feedingId: 99 } } });
    const user = await renderLoaded();

    await tapKeys(user, "30");
    await user.click(screen.getByRole("button", { name: "Log 30 g meal" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/feedings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ food_id: 1, grams: 30, is_treat: false, is_put_back: false }),
      }),
    );
    const budget = screen.getByRole("region", { name: "Today's budget" });
    await waitFor(() => expect(within(budget).getByText("60")).toBeInTheDocument());
    expect(gramsInput()).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Logged 30 g Chicken Pate");
  });

  it("logs with the Enter key", async () => {
    mockApi();
    const user = await renderLoaded();

    await user.type(gramsInput(), "12{Enter}");
    expect(postCalls()).toHaveLength(1);
  });

  it("logs a treat", async () => {
    mockApi({ foods: [...foods, churu] });
    const user = await renderLoaded();

    await user.click(foodChip("Churu"));
    await tapKeys(user, "14");
    await user.click(screen.getByRole("button", { name: "Log 14 g treat" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/feedings",
      expect.objectContaining({
        body: JSON.stringify({ food_id: 3, grams: 14, is_treat: true, is_put_back: false }),
      }),
    );
  });

  it("logs a put-back", async () => {
    mockApi({ postFeedingResponse: { ok: true, body: { ...baseStatus, remainingKcal: 128, feedingId: 99 } } });
    const user = await renderLoaded();

    await user.click(kindButton("Put back"));
    await tapKeys(user, "7");
    await user.click(screen.getByRole("button", { name: "Put back 7 g" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/feedings",
      expect.objectContaining({
        body: JSON.stringify({ food_id: 1, grams: 7, is_treat: false, is_put_back: true }),
      }),
    );
    const budget = screen.getByRole("region", { name: "Today's budget" });
    await waitFor(() => expect(within(budget).getByText("128")).toBeInTheDocument());
    expect(gramsInput()).toHaveValue("");
  });

  it("undoes the entry just logged", async () => {
    mockApi({ deleteFeedingResponse: { ok: true, body: { ...baseStatus, remainingKcal: 120 } } });
    const user = await renderLoaded();

    await tapKeys(user, "30");
    await user.click(screen.getByRole("button", { name: "Log 30 g meal" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));

    expect(fetch).toHaveBeenCalledWith("/api/feedings/99", { method: "DELETE" });
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("ignores repeat taps while a feeding is being logged", async () => {
    mockApi();
    // Hold the POST open (e.g. server waking up) until the test releases it.
    let releasePost!: () => void;
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/feedings" && init?.method === "POST") {
        return new Promise<void>((resolve) => {
          releasePost = resolve;
        }).then(() => respond(url, init));
      }
      return respond(url, init);
    });
    const user = await renderLoaded();

    await tapKeys(user, "30");
    const logButton = screen.getByRole("button", { name: "Log 30 g meal" });
    await user.click(logButton);
    await user.click(logButton);
    await user.type(gramsInput(), "{Enter}");

    expect(postCalls()).toHaveLength(1);
    expect(logButton).toBeDisabled();

    releasePost();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Logged 30 g"));
    expect(postCalls()).toHaveLength(1);
  });

  it("shows the server error when logging fails, and keeps the grams", async () => {
    mockApi({ postFeedingResponse: { ok: false, body: { error: "Not enough remaining budget" } } });
    const user = await renderLoaded();

    await tapKeys(user, "500");
    await user.click(screen.getByRole("button", { name: "Log 500 g meal" }));

    expect(await screen.findByText("Not enough remaining budget")).toBeInTheDocument();
    expect(gramsInput()).toHaveValue("500");
  });

  it("shows an empty state when no feedings have been logged today", async () => {
    mockApi();
    await renderLoaded();

    expect(screen.getByText("No feedings logged yet today.")).toBeInTheDocument();
  });

  it("lists today's feedings newest first", async () => {
    const events: FeedingEvent[] = [
      { id: 1, timestamp: "2026-01-01 08:05:00", food_id: 1, grams: 40, is_treat: false, is_put_back: false },
      { id: 2, timestamp: "2026-01-01 15:30:00", food_id: 2, grams: 5, is_treat: true, is_put_back: false },
      { id: 3, timestamp: "2026-01-01 22:10:00", food_id: 1, grams: 7, is_treat: false, is_put_back: true },
    ];
    mockApi({ feedingEvents: events });
    await renderLoaded();

    const list = screen.getByRole("region", { name: "Logged today" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    const [putBack, treat, meal] = within(list).getAllByRole("listitem");

    expect(putBack).toHaveTextContent("22:10");
    expect(putBack).toHaveTextContent("Chicken Pate");
    expect(putBack).toHaveTextContent("Put back");
    expect(putBack).toHaveTextContent("−7 g");
    expect(putBack).toHaveTextContent("−8 kcal");

    expect(treat).toHaveTextContent("15:30");
    expect(treat).toHaveTextContent("Kibble");
    expect(treat).toHaveTextContent("Treat");

    expect(meal).toHaveTextContent("08:05");
    expect(meal).toHaveTextContent("40 g");
    expect(meal).toHaveTextContent("48 kcal");
    expect(within(list).getByText("3 entries")).toBeInTheDocument();
  });
});
