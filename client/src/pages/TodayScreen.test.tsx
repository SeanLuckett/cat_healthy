import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProvider } from "../test-utils";
import TodayScreen from "./TodayScreen";
import type { Food, FeedingEvent, StatusResponse } from "../../../shared/types";

const foods: Food[] = [
  { id: 1, name: "Chicken Pate", kcal_per_gram: 1.2, category: "wet", notes: null },
  { id: 2, name: "Kibble", kcal_per_gram: 3.5, category: "dry", notes: null },
];

const baseStatus: StatusResponse = {
  dailyTargetKcal: 250,
  belowSafeFloor: false,
  remainingKcal: 120,
  mealsLeftToday: 2,
  suggestedGramsPerFood: { 1: 45.5, 2: 15 },
  weeklyLossRate: null,
  progressFlag: null,
  currentWeightKg: 5.1,
};

const mockApi = (
  statusOverride: Partial<StatusResponse> = {},
  postFeedingResponse?: { ok: boolean; body: unknown },
  feedingEvents: FeedingEvent[] = [],
) => {
  const status = { ...baseStatus, ...statusOverride };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/foods") {
        return Promise.resolve({ ok: true, json: async () => foods } as Response);
      }
      if (url === "/api/feedings" && init?.method === "POST") {
        const result = postFeedingResponse ?? { ok: true, body: status };
        return Promise.resolve({
          ok: result.ok,
          json: async () => result.body,
        } as Response);
      }
      if (url === "/api/feedings") {
        return Promise.resolve({
          ok: true,
          json: async () => feedingEvents,
        } as Response);
      }
      if (url === "/api/status") {
        return Promise.resolve({ ok: true, json: async () => status } as Response);
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }),
  );
  return status;
};

describe("TodayScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state before status arrives, then renders it", async () => {
    mockApi();
    renderWithProvider(<TodayScreen />);

    expect(screen.getByText("Loading…")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/120 kcal/)).toBeInTheDocument());
    expect(screen.getByText(/2 meal\(s\) left/)).toBeInTheDocument();
  });

  it("defaults the food selection to the first food and shows its suggested grams", async () => {
    mockApi();
    renderWithProvider(<TodayScreen />);

    await waitFor(() => expect(screen.getByText(/45.5 g/)).toBeInTheDocument());
    expect(screen.getByDisplayValue("Chicken Pate")).toBeInTheDocument();
  });

  it("updates the suggested grams when a different food is selected", async () => {
    mockApi();
    renderWithProvider(<TodayScreen />);
    await waitFor(() => expect(screen.getByText(/45.5 g/)).toBeInTheDocument());

    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox", { name: "Food" }));
    await user.click(await screen.findByRole("option", { name: "Kibble" }));

    await waitFor(() => expect(screen.getByText(/15.0 g/)).toBeInTheDocument());
  });

  it.each([
    ["too_fast", "Losing too fast"],
    ["reversing", "Gaining weight"],
    ["stalled", "Progress stalled"],
  ] as const)("shows a %s banner", async (progressFlag, title) => {
    mockApi({ progressFlag, weeklyLossRate: 0.03 });
    renderWithProvider(<TodayScreen />);

    await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument());
    expect(screen.getByText("3.0%/week")).toBeInTheDocument();
  });

  it("shows no banner when progressFlag is null", async () => {
    mockApi({ progressFlag: null });
    renderWithProvider(<TodayScreen />);

    await waitFor(() => expect(screen.getByText(/120 kcal/)).toBeInTheDocument());
    expect(screen.queryByText("Losing too fast")).not.toBeInTheDocument();
    expect(screen.queryByText("Gaining weight")).not.toBeInTheDocument();
    expect(screen.queryByText("Progress stalled")).not.toBeInTheDocument();
  });

  it("warns when today's target is below the safe calorie floor", async () => {
    mockApi({ belowSafeFloor: true });
    renderWithProvider(<TodayScreen />);

    await waitFor(() =>
      expect(screen.getByText("Below safe calorie floor")).toBeInTheDocument(),
    );
  });

  it("logs a feeding and clears the input on success", async () => {
    const updatedStatus = { ...baseStatus, remainingKcal: 60 };
    mockApi({}, { ok: true, body: updatedStatus });
    renderWithProvider(<TodayScreen />);
    await waitFor(() => expect(screen.getByText(/120 kcal/)).toBeInTheDocument());

    const user = userEvent.setup();
    const gramsInput = screen.getByLabelText("Log feeding (grams)");
    await user.type(gramsInput, "30");
    await user.click(screen.getByRole("button", { name: "Log feeding" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/feedings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          food_id: 1,
          grams: 30,
          is_treat: false,
        }),
      }),
    );

    await waitFor(() => expect(screen.getByText(/60 kcal/)).toBeInTheDocument());
    expect(gramsInput).toHaveValue("");
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
    renderWithProvider(<TodayScreen />);
    await waitFor(() => expect(screen.getByText(/120 kcal/)).toBeInTheDocument());

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Log feeding (grams)"), "30");
    const logButton = screen.getByRole("button", { name: "Log feeding" });
    await user.click(logButton);
    await user.click(logButton);
    await user.click(logButton);

    const posts = () =>
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts()).toHaveLength(1);
    expect(logButton).toBeDisabled();
    expect(screen.getByRole("button", { name: "Log treat" })).toBeDisabled();

    releasePost();
    await waitFor(() => expect(logButton).toBeEnabled());
    expect(posts()).toHaveLength(1);
  });

  it("shows the server error when logging a feeding fails", async () => {
    mockApi({}, { ok: false, body: { error: "Not enough remaining budget" } });
    renderWithProvider(<TodayScreen />);
    await waitFor(() => expect(screen.getByText(/120 kcal/)).toBeInTheDocument());

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Log feeding (grams)"), "500");
    await user.click(screen.getByRole("button", { name: "Log feeding" }));

    await waitFor(() =>
      expect(screen.getByText("Not enough remaining budget")).toBeInTheDocument(),
    );
  });

  it("shows an empty state when no feedings have been logged today", async () => {
    mockApi();
    renderWithProvider(<TodayScreen />);

    await waitFor(() => expect(screen.getByText(/120 kcal/)).toBeInTheDocument());
    expect(screen.getByText("No feedings logged yet today.")).toBeInTheDocument();
  });

  it("renders today's feeding events in a table", async () => {
    const events: FeedingEvent[] = [
      {
        id: 1,
        timestamp: "2026-01-01 08:05:00",
        food_id: 1,
        grams: 40,
        meal_slot: 1,
        is_treat: false,
      },
      {
        id: 2,
        timestamp: "2026-01-01 15:30:00",
        food_id: 2,
        grams: 5,
        meal_slot: null,
        is_treat: true,
      },
    ];
    mockApi({}, undefined, events);
    renderWithProvider(<TodayScreen />);

    await waitFor(() => expect(screen.getByText(/120 kcal/)).toBeInTheDocument());

    const table = within(screen.getByRole("table"));
    expect(table.getByText("08:05")).toBeInTheDocument();
    expect(table.getByText("15:30")).toBeInTheDocument();
    expect(table.getByText("Chicken Pate")).toBeInTheDocument();
    expect(table.getByText("Kibble")).toBeInTheDocument();
    expect(table.getByText("Breakfast")).toBeInTheDocument();
    expect(table.getByText("Treat")).toBeInTheDocument();
  });
});
