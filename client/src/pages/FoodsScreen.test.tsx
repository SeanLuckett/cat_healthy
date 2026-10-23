import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProvider } from "../test-utils";
import FoodsScreen from "./FoodsScreen";
import type { Food } from "../../../shared/types";

const foods: Food[] = [
  { id: 1, name: "Old Treat", kcal_per_gram: 0.6, category: "treat", notes: null, archived: true },
  { id: 2, name: "Chicken Pate", kcal_per_gram: 1.2, category: "wet", notes: null, archived: false },
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
        return Promise.resolve({
          ok: result.ok,
          json: async () => result.body,
        } as Response);
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

  it("lists active foods before archived ones", async () => {
    mockApi();
    renderWithProvider(<FoodsScreen />);

    await waitFor(() => expect(screen.getByText("Chicken Pate")).toBeInTheDocument());
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Chicken Pate")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Old Treat")).toBeInTheDocument();
  });

  it("archives an active food", async () => {
    mockApi();
    renderWithProvider(<FoodsScreen />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Chicken Pate" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/foods/2",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Unarchive Chicken Pate" }),
    ).toBeInTheDocument();
  });

  it("unarchives an archived food", async () => {
    mockApi();
    renderWithProvider(<FoodsScreen />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Unarchive Old Treat" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/foods/1",
      expect.objectContaining({ body: JSON.stringify({ archived: false }) }),
    );
    expect(
      await screen.findByRole("button", { name: "Archive Old Treat" }),
    ).toBeInTheDocument();
  });

  it("shows the server error when archiving fails", async () => {
    mockApi({ ok: false, body: { error: "food_id 2 does not exist" } });
    renderWithProvider(<FoodsScreen />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive Chicken Pate" }));

    expect(await screen.findByText("food_id 2 does not exist")).toBeInTheDocument();
  });
});
