import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProvider } from "../test-utils";
import WeightScreen from "./WeightScreen";
import type { ProgressFlag, WeightLog } from "../../../shared/types";

const logs: WeightLog[] = [
  { id: 1, date: "2026-09-01", weight_kg: 5.2, notes: "starting point" },
  { id: 2, date: "2026-09-08", weight_kg: 5.1, notes: null },
];

interface MockOptions {
  logs?: WeightLog[];
  progressFlag?: ProgressFlag;
  weeklyLossRate?: number | null;
  smoothedWeightKg?: number | null;
  postWeightResponse?: { ok: boolean; body: unknown };
}

const mockApi = ({
  logs: logsOverride = logs,
  progressFlag = null,
  weeklyLossRate = null,
  smoothedWeightKg = null,
  postWeightResponse,
}: MockOptions = {}) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/weight" && init?.method === "POST") {
        const result = postWeightResponse ?? {
          ok: true,
          body: { weeklyLossRate, progressFlag, smoothedWeightKg },
        };
        return Promise.resolve({
          ok: result.ok,
          json: async () => result.body,
        } as Response);
      }
      if (url === "/api/weight") {
        return Promise.resolve({ ok: true, json: async () => logsOverride } as Response);
      }
      if (url === "/api/status") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ weeklyLossRate, progressFlag, smoothedWeightKg }),
        } as Response);
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }),
  );
};

describe("WeightScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders logged weigh-ins in a table", async () => {
    mockApi();
    renderWithProvider(<WeightScreen />);

    await waitFor(() => expect(screen.getByText("2026-09-01")).toBeInTheDocument());
    expect(screen.getByText("5.2")).toBeInTheDocument();
    expect(screen.getByText("starting point")).toBeInTheDocument();
    expect(screen.getByText("2026-09-08")).toBeInTheDocument();
  });

  it("shows an empty state when there are no weigh-ins", async () => {
    mockApi({ logs: [] });
    renderWithProvider(<WeightScreen />);

    await waitFor(() =>
      expect(screen.getByText("No weigh-ins logged yet.")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it.each([
    ["too_fast", "Losing too fast"],
    ["reversing", "Gaining weight"],
    ["stalled", "Progress stalled"],
  ] as const)("shows a %s banner from status on load", async (progressFlag, title) => {
    mockApi({ progressFlag, weeklyLossRate: 0.05 });
    renderWithProvider(<WeightScreen />);

    await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument());
    expect(screen.getByText("5.0%/week")).toBeInTheDocument();
  });

  it("shows no banner when progressFlag is null", async () => {
    mockApi();
    renderWithProvider(<WeightScreen />);

    await waitFor(() => expect(screen.getByText("2026-09-01")).toBeInTheDocument());
    expect(screen.queryByText("Losing too fast")).not.toBeInTheDocument();
    expect(screen.queryByText("Gaining weight")).not.toBeInTheDocument();
    expect(screen.queryByText("Progress stalled")).not.toBeInTheDocument();
  });

  it.each([
    [0.008, "Trend: losing 0.8%/week"],
    [-0.005, "Trend: gaining 0.5%/week"],
  ])("shows a neutral trend line for rate %s when there's no flag", async (weeklyLossRate, text) => {
    mockApi({ weeklyLossRate });
    renderWithProvider(<WeightScreen />);

    await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a warm-up message when there isn't enough data for a trend", async () => {
    mockApi({ weeklyLossRate: null });
    renderWithProvider(<WeightScreen />);

    await waitFor(() =>
      expect(screen.getByText(/Trend: not enough weigh-ins yet/)).toBeInTheDocument(),
    );
  });

  it("hides the trend line when a banner is already showing the rate", async () => {
    mockApi({ progressFlag: "too_fast", weeklyLossRate: 0.03 });
    renderWithProvider(<WeightScreen />);

    await waitFor(() => expect(screen.getByText("Losing too fast")).toBeInTheDocument());
    expect(screen.queryByText(/^Trend:/)).not.toBeInTheDocument();
  });

  it.each([
    [null, "Trend: losing 1.8%/week"],
    ["too_fast", "Losing too fast"],
  ] as const)("shows the average weight alongside the trend (flag %s)", async (progressFlag, trend) => {
    mockApi({ progressFlag, weeklyLossRate: 0.018, smoothedWeightKg: 7.6123 });
    renderWithProvider(<WeightScreen />);

    await waitFor(() => expect(screen.getByText("Avg weight: 7.61 kg")).toBeInTheDocument());
    expect(screen.getByText(trend)).toBeInTheDocument();
  });

  it("hides the average weight when there are no weigh-ins", async () => {
    mockApi({ logs: [], smoothedWeightKg: null });
    renderWithProvider(<WeightScreen />);

    await waitFor(() =>
      expect(screen.getByText("No weigh-ins logged yet.")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/^Avg weight:/)).not.toBeInTheDocument();
  });

  it("adds a weigh-in, refreshes the table, and updates the progress banner", async () => {
    mockApi({ progressFlag: "too_fast", weeklyLossRate: 0.04 });
    renderWithProvider(<WeightScreen />);
    await waitFor(() => expect(screen.getByText("2026-09-01")).toBeInTheDocument());

    const newLog: WeightLog = { id: 3, date: "2026-09-15", weight_kg: 5.0, notes: null };
    // After the POST succeeds, the follow-up GET /api/weight should reflect the new entry.
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string, init?: RequestInit) => {
        if (url === "/api/weight" && init?.method === "POST") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ weeklyLossRate: 0.02, progressFlag: "stalled" }),
          } as Response);
        }
        if (url === "/api/weight") {
          return Promise.resolve({ ok: true, json: async () => [...logs, newLog] } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ weeklyLossRate: 0.04, progressFlag: "too_fast" }),
        } as Response);
      },
    );

    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Date"));
    await user.type(screen.getByLabelText("Date"), "2026-09-15");
    await user.type(screen.getByLabelText("Weight (kg)"), "5");
    await user.click(screen.getByRole("button", { name: "Add entry" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/weight",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ date: "2026-09-15", weight_kg: 5, notes: null }),
      }),
    );

    await waitFor(() => expect(screen.getByText("2026-09-15")).toBeInTheDocument());
    expect(screen.getByText("Progress stalled")).toBeInTheDocument();
    expect(screen.getByLabelText("Weight (kg)")).toHaveValue("");
  });

  it("ignores repeat taps while a weigh-in is being added", async () => {
    mockApi();
    // Hold the POST open (e.g. server waking up) until the test releases it.
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
    renderWithProvider(<WeightScreen />);
    await waitFor(() => expect(screen.getByText("2026-09-01")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Weight (kg)"), "5");
    const addButton = screen.getByRole("button", { name: "Add entry" });
    await user.click(addButton);
    await user.click(addButton);
    await user.click(addButton);

    const posts = () =>
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts()).toHaveLength(1);
    expect(addButton).toBeDisabled();

    releasePost();
    await waitFor(() => expect(addButton).toBeEnabled());
    expect(posts()).toHaveLength(1);
  });

  it("shows the server error when adding a weigh-in fails", async () => {
    mockApi({ postWeightResponse: { ok: false, body: { error: "Invalid weight" } } });
    renderWithProvider(<WeightScreen />);
    await waitFor(() => expect(screen.getByText("2026-09-01")).toBeInTheDocument());

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Weight (kg)"), "5");
    await user.click(screen.getByRole("button", { name: "Add entry" }));

    await waitFor(() => expect(screen.getByText("Invalid weight")).toBeInTheDocument());
  });
});
