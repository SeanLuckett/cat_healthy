import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WeightScreen from "./WeightScreen";
import type { ProgressFlag, WeightLog } from "../../../shared/types";

// /api/weight returns newest first.
const logs: WeightLog[] = [
  { id: 2, date: "2026-10-08", weight_kg: 5.1, notes: null },
  { id: 1, date: "2026-10-01", weight_kg: 5.2, notes: "starting point" },
];

interface MockOptions {
  logs?: WeightLog[];
  progressFlag?: ProgressFlag;
  weeklyLossRate?: number | null;
  weeklyLossRateMargin?: number | null;
  smoothedWeightKg?: number | null;
  targetWeightKg?: number | null;
  postWeightResponse?: { ok: boolean; body: unknown };
}

const mockApi = ({
  logs: logsOverride = logs,
  progressFlag = null,
  weeklyLossRate = null,
  weeklyLossRateMargin = null,
  smoothedWeightKg = null,
  targetWeightKg = null,
  postWeightResponse,
}: MockOptions = {}) => {
  const reply = (ok: boolean, body: unknown) =>
    Promise.resolve({ ok, json: async () => body } as Response);
  const progress = { weeklyLossRate, weeklyLossRateMargin, progressFlag, smoothedWeightKg };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/weight" && init?.method === "POST") {
        const result = postWeightResponse ?? { ok: true, body: progress };
        return reply(result.ok, result.body);
      }
      if (url === "/api/weight") return reply(true, logsOverride);
      if (url === "/api/weight/smoothed") return reply(true, []);
      if (url === "/api/status") return reply(true, progress);
      if (url === "/api/profile") {
        return reply(true, { id: 1, target_weight_kg: targetWeightKg, life_stage_factor: 1.2, goal: "weight_loss", manual_override_kcal: null });
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }),
  );
};

const recentList = () => screen.getByRole("region", { name: "Recent weigh-ins" });
const hero = () => screen.getByRole("region", { name: "Progress" });

describe("WeightScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists logged weigh-ins with the change from the one before", async () => {
    mockApi();
    render(<WeightScreen />);

    await waitFor(() => expect(within(recentList()).getAllByRole("listitem")).toHaveLength(2));
    const [newer, older] = within(recentList()).getAllByRole("listitem");
    expect(newer).toHaveTextContent("Thu 8 Oct");
    expect(newer).toHaveTextContent("5.100");
    expect(newer).toHaveTextContent("−100 g");
    expect(older).toHaveTextContent("Thu 1 Oct");
    expect(older).toHaveTextContent("starting point");
  });

  it("lists only the 7 most recent weigh-ins", async () => {
    const manyLogs: WeightLog[] = Array.from({ length: 9 }, (_, i) => ({
      id: i + 1,
      date: `2026-10-${String(9 - i).padStart(2, "0")}`,
      weight_kg: 5.0,
      notes: null,
    }));
    mockApi({ logs: manyLogs });
    render(<WeightScreen />);

    await waitFor(() => expect(within(recentList()).getAllByRole("listitem")).toHaveLength(7));
    expect(within(recentList()).getByText("Fri 9 Oct")).toBeInTheDocument();
    expect(within(recentList()).getByText("Sat 3 Oct")).toBeInTheDocument();
    expect(within(recentList()).queryByText("Fri 2 Oct")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no weigh-ins", async () => {
    mockApi({ logs: [] });
    render(<WeightScreen />);

    expect(await screen.findByText("No weigh-ins logged yet.")).toBeInTheDocument();
    expect(within(hero()).getByText("No weigh-ins yet")).toBeInTheDocument();
  });

  it("shows the smoothed weight in kg and lb", async () => {
    mockApi({ smoothedWeightKg: 7.978 });
    render(<WeightScreen />);

    await waitFor(() => expect(within(hero()).getByText("7.98")).toBeInTheDocument());
    expect(within(hero()).getByText(/17\.59 lb · last weigh-in 5\.1 kg 8 Oct/)).toBeInTheDocument();
  });

  it.each([
    ["too_fast", "Losing too fast"],
    ["reversing", "Gaining weight"],
    ["stalled", "Progress stalled"],
  ] as const)("shows a %s warning from status on load", async (progressFlag, title) => {
    mockApi({ progressFlag, weeklyLossRate: 0.05 });
    render(<WeightScreen />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(title);
    expect(alert).toHaveTextContent("5.0%/week");
  });

  it.each([
    [0.008, "Trend: losing 0.8%/week"],
    [-0.005, "Trend: gaining 0.5%/week"],
  ])("shows a neutral trend for rate %s when there's no flag", async (weeklyLossRate, text) => {
    mockApi({ weeklyLossRate });
    render(<WeightScreen />);

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the margin alongside the rate", async () => {
    mockApi({ weeklyLossRate: 0.006, weeklyLossRateMargin: 0.004 });
    render(<WeightScreen />);

    expect(await screen.findByText("Trend: losing 0.6%/week (±0.4)")).toBeInTheDocument();
  });

  it("shows a warm-up message when there isn't enough data for a trend", async () => {
    mockApi();
    render(<WeightScreen />);

    expect(await screen.findByText("Trend: not enough weigh-ins yet")).toBeInTheDocument();
  });

  it("shows progress from the first weigh-in toward the target", async () => {
    // 5.2 → 5.0 target, smoothed 5.1: halfway.
    mockApi({ smoothedWeightKg: 5.1, targetWeightKg: 5.0 });
    render(<WeightScreen />);

    expect(await screen.findByText("50% there")).toBeInTheDocument();
    expect(within(hero()).getByText("5.2 kg")).toBeInTheDocument();
    expect(within(hero()).getByText("5 kg")).toBeInTheDocument();
  });

  it("leaves out the progress bar when there's no target", async () => {
    mockApi({ smoothedWeightKg: 5.1 });
    render(<WeightScreen />);

    await waitFor(() => expect(within(hero()).getByText("5.10")).toBeInTheDocument());
    expect(screen.queryByText(/% there/)).not.toBeInTheDocument();
  });

  it("previews the weight in lb before saving", async () => {
    mockApi({ smoothedWeightKg: 5.1 });
    render(<WeightScreen />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Weight (kg)"), "5");
    const lcd = screen.getByLabelText("Weight (kg)").closest(".lcd")!;
    expect(lcd).toHaveTextContent("11.02 lb");
    expect(lcd).toHaveTextContent("−100 g vs smoothed");
  });

  it("adds a weigh-in, refreshes the list, and updates the trend", async () => {
    mockApi({ postWeightResponse: { ok: true, body: { weeklyLossRate: 0.03, weeklyLossRateMargin: 0.002, progressFlag: "too_fast", smoothedWeightKg: 5.0 } } });
    render(<WeightScreen />);
    await waitFor(() => expect(within(recentList()).getAllByRole("listitem")).toHaveLength(2));

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Date"));
    await user.type(screen.getByLabelText("Date"), "2026-10-15");
    await user.type(screen.getByLabelText("Weight (kg)"), "4.95");
    await user.type(screen.getByLabelText("Note"), "after vet");
    await user.click(screen.getByRole("button", { name: "Save weigh-in" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/weight",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ date: "2026-10-15", weight_kg: 4.95, notes: "after vet" }),
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Losing too fast");
    expect(screen.getByRole("status")).toHaveTextContent("Saved 4.95 kg for 15 Oct");
    expect(screen.getByLabelText("Weight (kg)")).toHaveValue("");
    expect(screen.getByLabelText("Note")).toHaveValue("");
    const getCalls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url, init]) => url === "/api/weight" && !init,
    );
    expect(getCalls).toHaveLength(2);
  });

  it("keeps Save disabled until a weight is entered", async () => {
    mockApi();
    render(<WeightScreen />);

    expect(screen.getByRole("button", { name: "Save weigh-in" })).toBeDisabled();
    await userEvent.setup().type(screen.getByLabelText("Weight (kg)"), "5");
    expect(screen.getByRole("button", { name: "Save weigh-in" })).toBeEnabled();
  });

  it("ignores repeat taps while a weigh-in is being added", async () => {
    mockApi();
    let releasePost!: () => void;
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const respond = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/weight" && init?.method === "POST") {
        return new Promise<void>((resolve) => {
          releasePost = resolve;
        }).then(() => respond(url, init));
      }
      return respond(url, init);
    });
    render(<WeightScreen />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Weight (kg)"), "5");
    const saveButton = screen.getByRole("button", { name: "Save weigh-in" });
    await user.click(saveButton);
    await user.click(saveButton);
    await user.type(screen.getByLabelText("Weight (kg)"), "{Enter}");

    const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts()).toHaveLength(1);
    expect(saveButton).toBeDisabled();

    releasePost();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved 5 kg"));
    expect(posts()).toHaveLength(1);
  });

  it("shows the server error when adding a weigh-in fails", async () => {
    mockApi({ postWeightResponse: { ok: false, body: { error: "Invalid weight" } } });
    render(<WeightScreen />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Weight (kg)"), "5");
    await user.click(screen.getByRole("button", { name: "Save weigh-in" }));

    expect(await screen.findByText("Invalid weight")).toBeInTheDocument();
    expect(screen.getByLabelText("Weight (kg)")).toHaveValue("5");
  });
});
