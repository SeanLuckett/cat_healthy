import { useEffect, useState, type FormEvent } from "react";
import type {
  FeedingCreatedResponse,
  FeedingEvent,
  Food,
  StatusResponse,
} from "../../../shared/types";
import { Banner, PageHeader, ProgressBanner, formatDate, todayIso, useToast } from "../ui";

type EntryKind = "feeding" | "treat" | "put_back";

const KIND_LABEL: Record<EntryKind, string> = {
  feeding: "Meal",
  treat: "Treat",
  put_back: "Put back",
};

const formatTime = (timestamp: string): string => timestamp.slice(11, 16);

// Grams as typed on the keypad or keyboard: digits with at most one decimal
// place, up to 999.9 g. Anything else is dropped rather than rejected.
const sanitizeGrams = (raw: string): string => {
  const cleaned = raw.replace(",", ".").replace(/[^0-9.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  const intPart = whole.replace(/^0+(?=\d)/, "").slice(0, 3);
  if (rest.length === 0) return intPart;
  return `${intPart || "0"}.${rest.join("").slice(0, 1)}`;
};

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "del"] as const;

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

const BudgetRing = ({
  targetKcal,
  remainingKcal,
  pendingKcal,
  over,
}: {
  targetKcal: number;
  remainingKcal: number;
  pendingKcal: number;
  over: boolean;
}) => {
  const eaten = Math.min(Math.max(targetKcal - remainingKcal, 0), targetKcal);
  const eatenLen = (eaten / targetKcal) * RING_C;
  const pending = Math.min(Math.max(pendingKcal, 0), targetKcal - eaten);
  return (
    <div className={`ring${over ? " over" : ""}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="ring-track" cx="60" cy="60" r={RING_R} fill="none" strokeWidth="12" />
        <circle
          className="ring-eaten"
          cx="60" cy="60" r={RING_R} fill="none" strokeWidth="12"
          style={{ strokeDasharray: `${eatenLen} ${RING_C}` }}
        />
        <circle
          className="ring-pending"
          cx="60" cy="60" r={RING_R} fill="none" strokeWidth="12"
          style={{
            strokeDasharray: `${(pending / targetKcal) * RING_C} ${RING_C}`,
            strokeDashoffset: -eatenLen,
          }}
        />
      </svg>
      <div className="center">
        <div className="big">{remainingKcal.toFixed(0)}</div>
        <div className="lbl">kcal left</div>
      </div>
    </div>
  );
};

const TodayScreen = () => {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [feedingEvents, setFeedingEvents] = useState<FeedingEvent[]>([]);
  const [selectedFoodId, setSelectedFoodId] = useState<number | null>(null);
  const [kind, setKind] = useState<EntryKind>("feeding");
  const [grams, setGrams] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { showToast, toastNode } = useToast();

  const refetchFeedings = async () => {
    const res = await fetch("/api/feedings");
    setFeedingEvents(await res.json());
  };

  const refetch = async () => {
    const [statusRes, foodsRes] = await Promise.all([
      fetch("/api/status"),
      fetch("/api/foods"),
    ]);
    const statusBody = await statusRes.json();
    if (!statusRes.ok) {
      setError(statusBody.error ?? "Couldn't load today's status");
      return;
    }
    setStatus(statusBody);
    setFoods(await foodsRes.json());
    await refetchFeedings();
  };

  useEffect(() => {
    refetch();
  }, []);

  // Archived foods stay in `foods` so today's list can still name them.
  const pickableFoods = foods.filter((f) => !f.archived);

  useEffect(() => {
    if (selectedFoodId == null && pickableFoods.length > 0) {
      setSelectedFoodId(pickableFoods[0].id);
    }
  }, [foods, selectedFoodId]);

  const selectedFood = foods.find((f) => f.id === selectedFoodId);

  const selectFood = (food: Food) => {
    setSelectedFoodId(food.id);
    // Picking a treat food almost always means logging a treat, and vice versa.
    if (food.category === "treat" && kind === "feeding") setKind("treat");
    if (food.category !== "treat" && kind === "treat") setKind("feeding");
  };

  const pressKey = (key: (typeof KEYS)[number]) => {
    if (key === "del") setGrams((g) => g.slice(0, -1));
    else setGrams((g) => sanitizeGrams(g + key));
  };

  const gramsNum = grams === "" ? 0 : Number(grams);

  const logFeeding = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting || selectedFoodId == null || !(gramsNum > 0)) return;
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/feedings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        food_id: selectedFoodId,
        grams: gramsNum,
        is_treat: kind === "treat",
        is_put_back: kind === "put_back",
      }),
    }).finally(() => setSubmitting(false));
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Couldn't log that. Try again.");
      return;
    }
    const { feedingId, ...newStatus } = body as FeedingCreatedResponse;
    setStatus(newStatus);
    setGrams("");
    const name = selectedFood?.name ?? "food";
    showToast(
      kind === "put_back" ? `Put back ${gramsNum} g ${name}` : `Logged ${gramsNum} g ${name}`,
      () => undoFeeding(feedingId),
    );
    await refetchFeedings();
  };

  const undoFeeding = async (id: number) => {
    const res = await fetch(`/api/feedings/${id}`, { method: "DELETE" });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Couldn't undo that entry");
      return;
    }
    setStatus(body);
    await refetchFeedings();
  };

  if (!status) {
    return (
      <>
        <PageHeader eyebrow={formatDate(todayIso(), true)} title="Mac’s bowl" />
        {error ? <Banner tone="bad" title="Error">{error}</Banner> : <p className="loading">Loading…</p>}
      </>
    );
  }

  const { remainingKcal, dailyTargetKcal } = status;
  const kcalPerGram = selectedFood?.kcal_per_gram ?? 0;
  const entryKcal = gramsNum * kcalPerGram;
  const after = kind === "put_back" ? remainingKcal + entryKcal : remainingKcal - entryKcal;
  const over = kind !== "put_back" && gramsNum > 0 && Math.round(after) < 0;
  const suggestedGrams =
    selectedFoodId != null ? status.suggestedGramsPerFood[selectedFoodId] : null;
  const restOfToday =
    selectedFood && remainingKcal > 0 ? remainingKcal / selectedFood.kcal_per_gram : null;

  const quickPicks: Array<[string, number]> = [];
  if (kind === "feeding" && suggestedGrams != null) quickPicks.push(["Next serving", suggestedGrams]);
  if (kind !== "put_back" && restOfToday != null) quickPicks.push(["Rest of today", restOfToday]);

  const eatenKcal = dailyTargetKcal - remainingKcal;
  const newestFirst = [...feedingEvents].reverse();

  return (
    <>
      <PageHeader eyebrow={formatDate(todayIso(), true)} title="Mac’s bowl" />

      <div className="banners">
        <ProgressBanner flag={status.progressFlag} rate={status.weeklyLossRate} />
        {status.belowSafeFloor && (
          <Banner tone="bad" title="Below safe calorie floor">
            Today's target is below 70% of RER at current weight. Check with the
            vet before feeding less than this.
          </Banner>
        )}
        {error && <Banner tone="bad" title="Error">{error}</Banner>}
      </div>

      <div className="today">
        <section className="card budget" aria-label="Today's budget">
          <BudgetRing
            targetKcal={dailyTargetKcal}
            remainingKcal={remainingKcal}
            pendingKcal={kind === "put_back" ? 0 : entryKcal}
            over={over}
          />
          <dl className="stats">
            <div className="stat"><dt>Daily target</dt><dd>{dailyTargetKcal.toFixed(0)} kcal</dd></div>
            <div className="stat"><dt>Eaten so far</dt><dd>{eatenKcal.toFixed(0)} kcal</dd></div>
            <div className="stat"><dt>Meals left</dt><dd>{status.feedingsLeftToday}</dd></div>
            <div className="stat">
              <dt>Next serving</dt>
              <dd>{suggestedGrams != null ? `${suggestedGrams.toFixed(1)} g` : "—"}</dd>
            </div>
          </dl>
        </section>

        <form className="card logger" onSubmit={logFeeding} aria-label="Log food">
          <div className="seg" role="group" aria-label="Entry type">
            {(Object.keys(KIND_LABEL) as EntryKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          <div className="food-pick" role="group" aria-label="Food">
            {pickableFoods.map((f) => (
              <button
                key={f.id}
                type="button"
                className="food-chip"
                aria-pressed={f.id === selectedFoodId}
                onClick={() => selectFood(f)}
              >
                <b>{f.name}</b>
                <span>{f.kcal_per_gram} kcal/g</span>
              </button>
            ))}
          </div>

          <div className="lcd">
            <span className="mode-tag">{KIND_LABEL[kind]}</span>
            <div className="row">
              <div className="digits">
                <span className="ghost" aria-hidden="true">888.8</span>
                <input
                  id="grams"
                  aria-label="Grams"
                  // The on-screen keypad replaces the phone keyboard, which
                  // would otherwise cover half the screen. A desktop
                  // keyboard still types here.
                  inputMode="none"
                  autoComplete="off"
                  placeholder="0"
                  value={grams}
                  onChange={(e) => setGrams(sanitizeGrams(e.currentTarget.value))}
                />
              </div>
              <span className="unit">g</span>
            </div>
            <div className="meta" aria-live="polite">
              <span>{gramsNum > 0 ? `${entryKcal.toFixed(0)} kcal` : "—"}</span>
              {gramsNum === 0 ? (
                <span>{remainingKcal.toFixed(0)} kcal left</span>
              ) : kind === "put_back" ? (
                <span>back to {after.toFixed(0)} kcal left</span>
              ) : over ? (
                <span className="over">{(-after).toFixed(0)} kcal over budget</span>
              ) : (
                <span>leaves {after.toFixed(0)} kcal</span>
              )}
            </div>
          </div>

          <div className="quick">
            {quickPicks.map(([label, g]) => (
              <button
                key={label}
                type="button"
                className="qchip"
                onClick={() => setGrams(String(Math.round(g * 10) / 10))}
              >
                {label} <b>{g.toFixed(1)} g</b>
              </button>
            ))}
          </div>

          <div className="keypad">
            {KEYS.map((k) => (
              <button
                key={k}
                type="button"
                className="key"
                aria-label={k === "del" ? "Delete digit" : k}
                onClick={() => pressKey(k)}
              >
                {k === "del" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 5h11v14H9l-6-7z" />
                    <path d="M12.5 9.5l5 5M17.5 9.5l-5 5" />
                  </svg>
                ) : (
                  k
                )}
              </button>
            ))}
          </div>

          <button
            type="submit"
            className={`go${kind === "put_back" ? " putback" : ""}`}
            disabled={submitting || !(gramsNum > 0) || !selectedFood}
          >
            {!(gramsNum > 0)
              ? "Enter grams"
              : kind === "put_back"
                ? `Put back ${grams} g`
                : `Log ${grams} g ${kind === "treat" ? "treat" : "meal"}`}
          </button>
        </form>

        <section className="card bowl" aria-label="Logged today">
          <div className="section-head">
            <h2>Logged today</h2>
            <small>
              {feedingEvents.length} {feedingEvents.length === 1 ? "entry" : "entries"}
            </small>
          </div>
          {newestFirst.length === 0 ? (
            <p className="empty">No feedings logged yet today.</p>
          ) : (
            <ul className="entries">
              {newestFirst.map((event) => {
                const food = foods.find((f) => f.id === event.food_id);
                const sign = event.is_put_back ? "−" : "";
                const kcal = food ? event.grams * food.kcal_per_gram : null;
                return (
                  <li key={event.id} className="entry">
                    <time>{formatTime(event.timestamp)}</time>
                    <div className="what">
                      <b>
                        {food?.name ?? "Unknown food"}
                        {event.is_treat && <span className="pill treat">Treat</span>}
                        {event.is_put_back && <span className="pill back">Put back</span>}
                      </b>
                      {food && <small>{food.kcal_per_gram} kcal/g</small>}
                    </div>
                    <div className="amt">
                      {sign}{event.grams} g
                      {kcal != null && <small>{sign}{kcal.toFixed(0)} kcal</small>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
      {toastNode}
    </>
  );
};

export default TodayScreen;
