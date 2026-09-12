import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type { Food, StatusResponse } from "../../../shared/types";

const flagBanner = (status: StatusResponse | null) => {
  if (!status?.progressFlag) return null;
  const rate = status.weeklyLossRate;
  const pct = rate != null ? `${(rate * 100).toFixed(1)}%/week` : "";

  if (status.progressFlag === "too_fast") {
    return (
      <Alert color="red" title="Losing too fast">
        {pct}
      </Alert>
    );
  }
  if (status.progressFlag === "reversing") {
    return (
      <Alert color="red" title="Gaining weight">
        {pct}
      </Alert>
    );
  }
  return (
    <Alert color="yellow" title="Progress stalled">
      {pct}
    </Alert>
  );
};

const TodayScreen = () => {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [selectedFoodId, setSelectedFoodId] = useState<string | null>(null);
  const [mealGrams, setMealGrams] = useState<number | "">("");
  const [treatGrams, setTreatGrams] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);

  const refetch = async () => {
    const [statusRes, foodsRes] = await Promise.all([
      fetch("/api/status"),
      fetch("/api/foods"),
    ]);
    setStatus(await statusRes.json());
    setFoods(await foodsRes.json());
  };

  useEffect(() => {
    refetch();
  }, []);

  useEffect(() => {
    if (!selectedFoodId && foods.length > 0) {
      setSelectedFoodId(String(foods[0].id));
    }
  }, [foods, selectedFoodId]);

  const suggestedGrams =
    status && selectedFoodId
      ? status.suggestedGramsPerFood[Number(selectedFoodId)]
      : null;

  const logFeeding = async (isTreat: boolean) => {
    const grams = isTreat ? treatGrams : mealGrams;
    if (!selectedFoodId || grams === "" || grams <= 0) return;
    setError(null);
    const res = await fetch("/api/feedings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        food_id: Number(selectedFoodId),
        grams,
        meal_slot: null,
        is_treat: isTreat,
      }),
    });
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Failed to log feeding");
      return;
    }
    setStatus(await res.json());
    if (isTreat) {
      setTreatGrams("");
    } else {
      setMealGrams("");
    }
  };

  if (!status) return <Text>Loading…</Text>;

  return (
    <Stack maw={480}>
      <Title order={2}>Today</Title>

      {flagBanner(status)}

      {status.belowSafeFloor && (
        <Alert color="red" title="Below safe calorie floor">
          Today's target is below 70% of RER at current weight — check with
          the vet before feeding less than this.
        </Alert>
      )}

      {error && (
        <Alert color="red" title="Error">
          {error}
        </Alert>
      )}

      <Card withBorder>
        <Text size="sm" c="dimmed">
          Remaining today
        </Text>
        <Text size="xl" fw={700}>
          {status.remainingKcal.toFixed(0)} kcal
        </Text>
        <Text size="sm" c="dimmed">
          {status.mealsLeftToday} meal(s) left
        </Text>
      </Card>

      <Select
        label="Food"
        data={foods.map((f) => ({ value: String(f.id), label: f.name }))}
        value={selectedFoodId}
        onChange={setSelectedFoodId}
      />

      {suggestedGrams != null && (
        <Text size="sm" c="dimmed">
          Suggested: {suggestedGrams.toFixed(1)} g for this meal
        </Text>
      )}

      <Group align="flex-end">
        <NumberInput
          label="Log feeding (grams)"
          value={mealGrams}
          onChange={(v) => setMealGrams(v === "" ? "" : Number(v))}
          min={0}
        />
        <Button onClick={() => logFeeding(false)}>Log feeding</Button>
      </Group>

      <Group align="flex-end">
        <NumberInput
          label="Log a treat (grams)"
          value={treatGrams}
          onChange={(v) => setTreatGrams(v === "" ? "" : Number(v))}
          min={0}
        />
        <Button variant="light" onClick={() => logFeeding(true)}>
          Log treat
        </Button>
      </Group>
    </Stack>
  );
};

export default TodayScreen;
