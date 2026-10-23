import { useEffect, useState } from "react";
import { Alert, Button, Stack, Table, Text, Title } from "@mantine/core";
import type { Food } from "../../../shared/types";

// Active foods first so the ones in use aren't buried under old ones.
const sortForDisplay = (foods: Food[]) =>
  [...foods].sort((a, b) => Number(a.archived) - Number(b.archived));

const FoodsScreen = () => {
  const [foods, setFoods] = useState<Food[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);

  useEffect(() => {
    const load = async () => {
      const res = await fetch("/api/foods");
      setFoods(await res.json());
    };
    load();
  }, []);

  const setArchived = async (food: Food, archived: boolean) => {
    if (pendingId != null) return;
    setError(null);
    setPendingId(food.id);
    const res = await fetch(`/api/foods/${food.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    }).finally(() => setPendingId(null));
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Failed to update food");
      return;
    }
    setFoods(body);
  };

  return (
    <Stack maw={640}>
      <Title order={2}>Foods</Title>
      <Text c="dimmed" size="sm">
        Archived foods are hidden from the food picker but stay in your
        feeding history.
      </Text>

      {error && (
        <Alert color="red" title="Error">
          {error}
        </Alert>
      )}

      {foods.length === 0 ? (
        <Text c="dimmed">No foods yet.</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>kcal/g</Table.Th>
              <Table.Th>Category</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sortForDisplay(foods).map((food) => (
              <Table.Tr key={food.id} c={food.archived ? "dimmed" : undefined}>
                <Table.Td>{food.name}</Table.Td>
                <Table.Td>{food.kcal_per_gram}</Table.Td>
                <Table.Td>{food.category}</Table.Td>
                <Table.Td>
                  <Button
                    size="compact-sm"
                    variant={food.archived ? "light" : "subtle"}
                    loading={pendingId === food.id}
                    onClick={() => setArchived(food, !food.archived)}
                    aria-label={`${food.archived ? "Unarchive" : "Archive"} ${food.name}`}
                  >
                    {food.archived ? "Unarchive" : "Archive"}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
};

export default FoodsScreen;
