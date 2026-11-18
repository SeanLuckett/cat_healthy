import { useEffect, useState } from "react";
import type { Food } from "../../../shared/types";
import { Banner, PageHeader } from "../ui";

const FoodCard = ({
  food,
  pending,
  onToggle,
}: {
  food: Food;
  pending: boolean;
  onToggle: () => void;
}) => (
  <article className={`card food${food.archived ? " archived" : ""}`}>
    <div className="food-head">
      <h3>{food.name}</h3>
      <span className={`cat ${food.category}`}>{food.category}</span>
    </div>
    <div className="density">
      <div>
        <span className="num">{food.kcal_per_gram}</span>
        <small>kcal / g</small>
      </div>
      <div>
        <span className="num">{(food.kcal_per_gram * 10).toFixed(1)}</span>
        <small>kcal / 10 g</small>
      </div>
    </div>
    {food.notes && <p>{food.notes}</p>}
    <button
      className="archive-btn"
      disabled={pending}
      onClick={onToggle}
      aria-label={`${food.archived ? "Unarchive" : "Archive"} ${food.name}`}
    >
      {food.archived ? "Unarchive" : "Archive"}
    </button>
  </article>
);

const FoodsScreen = () => {
  const [foods, setFoods] = useState<Food[] | null>(null);
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
      setError(body.error ?? "Couldn't update that food. Try again.");
      return;
    }
    setFoods(body);
  };

  const active = foods?.filter((f) => !f.archived) ?? [];
  const archived = foods?.filter((f) => f.archived) ?? [];
  const card = (f: Food) => (
    <FoodCard
      key={f.id}
      food={f}
      pending={pendingId === f.id}
      onToggle={() => setArchived(f, !f.archived)}
    />
  );

  return (
    <>
      <PageHeader eyebrow="Pantry" title="Foods" />
      <p className="intro">
        Archived foods drop out of the picker on the Today screen. They stay in
        past feedings so the history still adds up.
      </p>

      {error && (
        <div className="banners">
          <Banner tone="bad" title="Error">{error}</Banner>
        </div>
      )}

      {foods == null ? (
        <p className="loading">Loading…</p>
      ) : foods.length === 0 ? (
        <p className="empty">No foods yet.</p>
      ) : (
        <>
          <section className="food-list" aria-label="Active foods">
            {active.map(card)}
          </section>
          {archived.length > 0 && (
            <>
              <h2 className="subhead">Archived · {archived.length}</h2>
              <section className="food-list" aria-label="Archived foods">
                {archived.map(card)}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
};

export default FoodsScreen;
