import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ProgressFlag } from "../../shared/types";

export const KG_PER_LB = 0.45359237;
export const toLb = (kg: number) => kg / KG_PER_LB;

// Local date as YYYY-MM-DD, matching the server's date('now', 'localtime').
export const todayIso = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// "Wed 18 Nov" (withWeekday) or "18 Nov". Parsed at noon so no timezone can
// push the date across midnight.
export const formatDate = (iso: string, withWeekday = false) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(
    "en-GB",
    withWeekday
      ? { weekday: "short", day: "numeric", month: "short" }
      : { day: "numeric", month: "short" },
  );

export const PageHeader = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
  <header className="top">
    <div>
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
    </div>
  </header>
);

export const Banner = ({
  tone,
  title,
  children,
}: {
  tone: "bad" | "warn";
  title: string;
  children?: ReactNode;
}) => (
  <div className={`banner ${tone}`} role="alert">
    <b>{title}</b>
    {children && <span>{children}</span>}
  </div>
);

export const formatRate = (rate: number) => `${(rate * 100).toFixed(1)}%/week`;

const FLAG_COPY = {
  too_fast: { tone: "bad", title: "Losing too fast" },
  reversing: { tone: "bad", title: "Gaining weight" },
  stalled: { tone: "warn", title: "Progress stalled" },
} as const;

export const flagCopy = (flag: Exclude<ProgressFlag, null>) => FLAG_COPY[flag];

export const ProgressBanner = ({
  flag,
  rate,
}: {
  flag: ProgressFlag;
  rate: number | null;
}) => {
  if (!flag) return null;
  const { tone, title } = flagCopy(flag);
  return (
    <Banner tone={tone} title={title}>
      {rate != null ? formatRate(rate) : null}
    </Banner>
  );
};

interface ToastState {
  message: string;
  onUndo?: () => void;
}

// A short-lived message above the tab bar, with an optional Undo.
export const useToast = (durationMs = 5000) => {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const showToast = useCallback(
    (message: string, onUndo?: () => void) => {
      clearTimeout(timer.current);
      setToast({ message, onUndo });
      timer.current = setTimeout(() => setToast(null), durationMs);
    },
    [durationMs],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const node = (
    <div className={`toast${toast ? " show" : ""}`} role="status" aria-live="polite">
      <span>{toast?.message}</span>
      {toast?.onUndo && (
        <button
          type="button"
          onClick={() => {
            const undo = toast.onUndo!;
            clearTimeout(timer.current);
            setToast(null);
            undo();
          }}
        >
          Undo
        </button>
      )}
    </div>
  );

  return { showToast, toastNode: node };
};
