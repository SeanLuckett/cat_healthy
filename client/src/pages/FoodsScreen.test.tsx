import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FoodsScreen from "./FoodsScreen";
import type { Food } from "../../../shared/types";

const foods: Food[] = [
  { id: 1, name: "Old Treat", kcal_per_gram: 0.6, category: "treat", notes: null, archived: true },
  { id: 2, name: "Chicken Pate", kcal_per_gram: 1.2, category: "wet", notes: "Good quality pate", archived: false },
];

const mockApi = (patchResponse?: { ok: boolean; body: unknown }) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith("/api/foods/") && init?.method === "PATCH") {
        const { archived } = JSON.parse(init.body as string);
        const id = Number(url.split("/").pop());
        const result = patchResponse ?? {
          ok: true,
          body: foods.map((f) => (f.id === id ? { ...f, archived } : f)),
        };
        return Promise.resolve({ ok: result.ok, json: async () => result.body } as Response);
      }
      if (url === "/api/foods") {
        return Promise.resolve({ ok: true, json: async () => foods } as Response);
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }),
  );
};

describe("FoodsScreen", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("separates active foods from archived ones", async () => {
    mockApi();
    render(<FoodsScreen />);

    const active = await screen.findByRole("region", { name: "Active foods" });
    const archived = screen.getByRole("region", { name: "Archived foods" });
    expect(within(active).getByText("Chicken Pate")).toBeInTheDocument();
    expect(within(active).queryByText("Old Treat")).not.toBeInTheDocument();
    expect(within(archived).getByText("Old Treat")).toBeInTheDocument();
    expect(screen.getByText("Archived · 1")).toBeInTheDocument();
  });

  it("shows calorie density and notes", async () => {
    mockApi();
    render(<FoodsScreen />);

    const active = await screen.findByRole("region", { name: "Active foods" });
    expect(within(active).getByText("1.2")).toBeInTheDocument();
    expect(within(active).getByText("12.0")).toBeInTheDocument(); // per 10 g
    expect(within(active).getByText("Good quality pate")).toBeInTheDocument();
  });

  it("archives an active food", async () => {
    mockApi();
    render(<FoodsScreen />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Chicken Pate" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/foods/2",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ archived: true }) }),
    );
    expect(await screen.findByRole("button", { name: "Unarchive Chicken Pate" })).toBeInTheDocument();
  });

  it("unarchives an archived food", async () => {
    mockApi();
    render(<FoodsScreen />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unarchive Old Treat" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/foods/1",
      expect.objectContaining({ body: JSON.stringify({ archived: false }) }),
    );
    expect(await screen.findByRole("button", { name: "Archive Old Treat" })).toBeInTheDocument();
  });

  it("shows the server error when archiving fails", async () => {
    mockApi({ ok: false, body: { error: "food_id 2 does not exist" } });
    render(<FoodsScreen />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Chicken Pate" }));

    expect(await screen.findByText("food_id 2 does not exist")).toBeInTheDocument();
  });
});
