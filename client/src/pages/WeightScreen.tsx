import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Group,
  NumberInput,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type { ProgressFlag, WeightLog } from "../../../shared/types";

interface WeightMutationResult {
  weeklyLossRate: number | null;
  progressFlag: ProgressFlag;
  smoothedWeightKg: number | null;
}

const flagBanner = (
  progressFlag: ProgressFlag,
  weeklyLossRate: number | null,
) => {
  if (!progressFlag) return null;
  const pct =
    weeklyLossRate != null ? `${(weeklyLossRate * 100).toFixed(1)}%/week` : "";

  if (progressFlag === "too_fast") {
    return (
      <Alert color="red" title="Losing too fast">
        {pct}
      </Alert>
    );
  }
  if (progressFlag === "reversing") {
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

// Neutral readout for when no banner is up — the banner already shows the
// rate when there is one.
const trendLine = (weeklyLossRate: number | null) => {
  if (weeklyLossRate == null) {
    return "Trend: not enough weigh-ins yet (needs 4 days of weigh-ins spanning 10+ days)";
  }
  const direction = weeklyLossRate >= 0 ? "losing" : "gaining";
  return `Trend: ${direction} ${(Math.abs(weeklyLossRate) * 100).toFixed(1)}%/week`;
};

// Shown whether or not a banner is up — unlike the rate, it isn't repeated
// anywhere else.
const avgWeightLine = (smoothedWeightKg: number) =>
  `Avg weight: ${smoothedWeightKg.toFixed(2)} kg`;

const todayIso = () =>new Date().toISOString().slice(0, 10);

const WeightScreen = () => {
  const [logs, setLogs] = useState<WeightLog[]>([]);
  const [progress, setProgress] = useState<WeightMutationResult>({
    weeklyLossRate: null,
    progressFlag: null,
    smoothedWeightKg: null,
  });
  const [date, setDate] = useState(todayIso());
  const [weightKg, setWeightKg] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refetchLogs = async () => {
    const res = await fetch("/api/weight");
    setLogs(await res.json());
  };

  const refetchStatus = async () => {
    const res = await fetch("/api/status");
    if (!res.ok) return;
    const body = await res.json();
    setProgress({
      weeklyLossRate: body.weeklyLossRate,
      progressFlag: body.progressFlag,
      smoothedWeightKg: body.smoothedWeightKg,
    });
  };

  useEffect(() => {
    refetchLogs();
    refetchStatus();
  }, []);

  const addEntry = async () => {
    if (submitting || weightKg === "" || weightKg <= 0 || !date) return;
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/weight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, weight_kg: weightKg, notes: notes || null }),
    }).finally(() => setSubmitting(false));
    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "Failed to log weight");
      return;
    }
    setProgress(await res.json());
    setWeightKg("");
    setNotes("");
    await refetchLogs();
  };

  return (
    <Stack maw={480}>
      <Title order={2}>Weight</Title>

      {progress.smoothedWeightKg != null && (
        <Text fw={500}>{avgWeightLine(progress.smoothedWeightKg)}</Text>
      )}

      {flagBanner(progress.progressFlag, progress.weeklyLossRate) ?? (
        <Text c="dimmed" size="sm">
          {trendLine(progress.weeklyLossRate)}
        </Text>
      )}

      {error && (
        <Alert color="red" title="Error">
          {error}
        </Alert>
      )}

      <Group align="flex-end">
        <TextInput
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.currentTarget.value)}
        />
        <NumberInput
          label="Weight (kg)"
          value={weightKg}
          onChange={(v) => setWeightKg(v === "" ? "" : Number(v))}
          min={0}
          step={0.01}
        />
        <TextInput
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.currentTarget.value)}
        />
        <Button loading={submitting} onClick={addEntry}>
          Add entry
        </Button>
      </Group>

      {logs.length === 0 ? (
        <Text c="dimmed">No weigh-ins logged yet.</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Date</Table.Th>
              <Table.Th>Weight (kg)</Table.Th>
              <Table.Th>Notes</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {logs.map((log) => (
              <Table.Tr key={log.id}>
                <Table.Td>{log.date}</Table.Td>
                <Table.Td>{log.weight_kg}</Table.Td>
                <Table.Td>{log.notes ?? ""}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
};

export default WeightScreen;
