import { useEffect, useState, type ReactNode } from "react";
import TodayScreen from "./pages/TodayScreen";
import WeightScreen from "./pages/WeightScreen";
import FoodsScreen from "./pages/FoodsScreen";

type View = "today" | "weight" | "foods";

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  "aria-hidden": true,
} as const;

const TABS: Array<{ view: View; label: string; icon: ReactNode }> = [
  {
    view: "today",
    label: "Today",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 12h18M5 12a7 7 0 0 0 14 0" />
        <path d="M9 7c0-1.5 1-2 1-3.5M14 7c0-1.5 1-2 1-3.5" />
      </svg>
    ),
  },
  {
    view: "weight",
    label: "Weight",
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="4" width="18" height="16" rx="4" />
        <path d="M8.5 10.5a5 5 0 0 1 7 0M12 10.5l1.5-2" />
      </svg>
    ),
  },
  {
    view: "foods",
    label: "Foods",
    icon: (
      <svg {...ICON_PROPS}>
        <ellipse cx="12" cy="7" rx="8" ry="2.5" />
        <path d="M4 7v10c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V7" />
      </svg>
    ),
  },
];

// The tab lives in the URL hash so a reload or home-screen shortcut lands
// on the same screen.
const viewFromHash = (): View => {
  const hash = window.location.hash.slice(1);
  return TABS.some((t) => t.view === hash) ? (hash as View) : "today";
};

const App = () => {
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const onHashChange = () => {
      setView(viewFromHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div className="app">
      <nav className="nav" aria-label="Sections">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M6 27V9l6 5h8l6-5v18z" fill="var(--accent)" />
            <circle cx="12.5" cy="19" r="1.6" fill="var(--surface)" />
            <circle cx="19.5" cy="19" r="1.6" fill="var(--surface)" />
          </svg>
          Mac
        </div>
        {TABS.map((t) => (
          <button
            key={t.view}
            className="tab"
            aria-current={view === t.view ? "page" : undefined}
            onClick={() => {
              window.location.hash = t.view;
            }}
          >
            <span className="ico">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
      <main>
        {view === "today" && <TodayScreen />}
        {view === "weight" && <WeightScreen />}
        {view === "foods" && <FoodsScreen />}
      </main>
    </div>
  );
};

export default App;
