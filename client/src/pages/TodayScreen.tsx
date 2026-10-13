import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import type { Food, FeedingEvent, StatusResponse } from "../../../shared/types";

const formatTime = (timestamp: string): string => timestamp.slice(11, 16);

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

const KcalPreview = ({
  grams,
  food,
  remainingKcal,
  putBack = false,
}: {
  grams: number | "";
  food: Food | undefined;
  remainingKcal: number;
  putBack?: boolean;
}) => {
  if (!food || grams === "" || grams <= 0) return null;
  const kcal = grams * food.kcal_per_gram;
  if (putBack) {
    return (
      <Text size="sm" c="dimmed">
        {grams} g = {kcal.toFixed(0)} kcal · back to{" "}
        {(remainingKcal + kcal).toFixed(0)} kcal today
      </Text>
    );
  }
  const left = remainingKcal - kcal;
  const over = Math.round(left) < 0;
  return (
    <Text size="sm" c={over ? "red" : "dimmed"}>
      {grams} g = {kcal.toFixed(0)} kcal ·{" "}
      {over
        ? `${(-left).toFixed(0)} kcal over today's budget`
        : `leaves ${left.toFixed(0)} kcal today`}
    </Text>
  );
};

type EntryKind = "feeding" | "treat" | "put_back";

const TodayScreen = () => {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [feedingEvents, setFeedingEvents] = useState<FeedingEvent[]>([]);
  const [selectedFoodId, setSelectedFoodId] = useState<string | null>(null);
  const [mealGrams, setMealGrams] = useState<number | "">("");
  const [treatGrams, setTreatGrams] = useState<number | "">("");
  const [putBackGrams, setPutBackGrams] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refetchFeedings = async () => {
    const res = await fetch("/api/feedings");
    setFeedingEvents(await res.json());
  };

  const refetch = async () => {
    const [statusRes, foodsRes] = await Promise.all([
      fetch("/api/status"),
      fetch("/api/foods"),
    ]);
    setStatus(await statusRes.json());
    setFoods(await foodsRes.json());
    await refetchFeedings();
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

  const selectedFood = foods.find((f) => String(f.id) === selectedFoodId);

  const gramsByKind = {
    feeding: [mealGrams, setMealGrams],
    treat: [treatGrams, setTreatGrams],
    put_back: [putBackGrams, setPutBackGrams],
  } as const;

  const logFeeding = async (kind: EntryKind) => {
    const [grams, setGrams] = gramsByKind[kind];
    if (submitting || !selectedFoodId || grams === "" || grams <= 0) return;
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/feedings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        food_id: Number(selectedFoodId),
        grams,
        is_treat: kind === "treat",
        is_put_back: kind === "put_back",
      }),
    }).finally(() => setSubmitting(false));
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Failed to log feeding");
      return;
    }
    setStatus(await res.json());
    setGrams("");
    await refetchFeedings();
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
          {status.feedingsLeftToday} feeding(s) left
        </Text>
      </Card>

      <Select
        label="Food"
        data={foods.map((f) => ({ value: String(f.id), label: f.name }))}
        value={selectedFoodId}
        onChange={setSelectedFoodId}
      />

      {suggestedGrams != null && (
        <Button
          variant="subtle"
          size="compact-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setMealGrams(Number(suggestedGrams.toFixed(1)))}
        >
          Next serving: {suggestedGrams.toFixed(1)} g
        </Button>
      )}

      {selectedFood && status.remainingKcal > 0 && (
        <Text size="sm" c="dimmed">
          Rest of today:{" "}
          {(status.remainingKcal / selectedFood.kcal_per_gram).toFixed(1)} g
        </Text>
      )}

      <Stack gap={4}>
        <Group align="flex-end">
          <NumberInput
            label="Log feeding (grams)"
            value={mealGrams}
            onChange={(v) => setMealGrams(v === "" ? "" : Number(v))}
            min={0}
          />
          <Button loading={submitting} onClick={() => logFeeding("feeding")}>
            Log feeding
          </Button>
        </Group>
        <KcalPreview
          grams={mealGrams}
          food={selectedFood}
          remainingKcal={status.remainingKcal}
        />
      </Stack>

      <Stack gap={4}>
        <Group align="flex-end">
          <NumberInput
            label="Log a treat (grams)"
            value={treatGrams}
            onChange={(v) => setTreatGrams(v === "" ? "" : Number(v))}
            min={0}
          />
          <Button
            variant="light"
            loading={submitting}
            onClick={() => logFeeding("treat")}
          >
            Log treat
          </Button>
        </Group>
        <KcalPreview
          grams={treatGrams}
          food={selectedFood}
          remainingKcal={status.remainingKcal}
        />
      </Stack>

      <Stack gap={4}>
        <Group align="flex-end">
          <NumberInput
            label="Put back in fridge (grams)"
            value={putBackGrams}
            onChange={(v) => setPutBackGrams(v === "" ? "" : Number(v))}
            min={0}
          />
          <Button
            variant="default"
            loading={submitting}
            onClick={() => logFeeding("put_back")}
          >
            Put back
          </Button>
        </Group>
        <KcalPreview
          grams={putBackGrams}
          food={selectedFood}
          remainingKcal={status.remainingKcal}
          putBack
        />
      </Stack>

      {feedingEvents.length === 0 ? (
        <Text c="dimmed">No feedings logged yet today.</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Time</Table.Th>
              <Table.Th>Food</Table.Th>
              <Table.Th>Grams</Table.Th>
              <Table.Th>Type</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {feedingEvents.map((event) => (
              <Table.Tr key={event.id}>
                <Table.Td>{formatTime(event.timestamp)}</Table.Td>
                <Table.Td>
                  {foods.find((f) => f.id === event.food_id)?.name ?? "Unknown food"}
                </Table.Td>
                <Table.Td>
                  {event.is_put_back ? `−${event.grams}` : event.grams}
                </Table.Td>
                <Table.Td>
                  {event.is_put_back
                    ? "Put back"
                    : event.is_treat
                      ? "Treat"
                      : "Feeding"}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
};

export default TodayScreen;
