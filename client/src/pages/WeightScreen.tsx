import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import type {
  CatProfile,
  ProgressFlag,
  SmoothedWeightPoint,
  WeightLog,
} from "../../../shared/types";
import {
  Banner,
  PageHeader,
  flagCopy,
  formatDate,
  formatRate,
  toLb,
  todayIso,
  useToast,
} from "../ui";

interface Progress {
  weeklyLossRate: number | null;
  weeklyLossRateMargin: number | null;
  progressFlag: ProgressFlag;
  smoothedWeightKg: number | null;
}

// The list only shows the most recent weigh-ins; the trend, average and
// chart still use the full history.
const VISIBLE_WEIGHINS = 7;
const CHART_DAYS = 56;

const DAY_MS = 864e5;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

// Flag → banner-style chip; no flag → neutral readout with the ± range.
// The ± is the 90% range (95% confident on each side): with few or noisy
// weigh-ins it's wide, which is why no flag is up even if the rate itself
// looks off.
const TrendChip = ({ progress }: { progress: Progress }) => {
  const { progressFlag, weeklyLossRate, weeklyLossRateMargin } = progress;
  if (progressFlag) {
    const { tone, title } = flagCopy(progressFlag);
    return (
      <div>
        <div className={`trend-chip ${tone}`} role="alert">
          <span className="dot" />
          <span>{title}</span>
          {weeklyLossRate != null && <span className="num">{formatRate(weeklyLossRate)}</span>}
        </div>
      </div>
    );
  }
  if (weeklyLossRate == null) {
    return (
      <div>
        <div className="trend-chip"><span className="dot" />Trend: not enough weigh-ins yet</div>
        <div className="trend-note">Needs 4 days of weigh-ins spanning 10+ days.</div>
      </div>
    );
  }
  const direction = weeklyLossRate >= 0 ? "losing" : "gaining";
  const margin =
    weeklyLossRateMargin != null ? ` (±${(weeklyLossRateMargin * 100).toFixed(1)})` : "";
  return (
    <div>
      <div className="trend-chip">
        <span className="dot" />
        <span>{`Trend: ${direction} ${formatRate(Math.abs(weeklyLossRate))}${margin}`}</span>
      </div>
      {weeklyLossRateMargin != null && (
        <div className="trend-note">
          The ± is the likely range over the last 14 days. It narrows as daily weigh-ins add up.
        </div>
      )}
    </div>
  );
};

// Start weight → target, with the smoothed weight marked along the way.
const Journey = ({ startKg, targetKg, currentKg }: { startKg: number; targetKg: number; currentKg: number }) => {
  const pos = (kg: number) => {
    const t = (startKg - kg) / (startKg - targetKg);
    return 6 + Math.min(Math.max(t, 0), 1) * 88; // percent, with room for labels
  };
  const done = Math.min(Math.max((startKg - currentKg) / (startKg - targetKg), 0), 1);
  return (
    <div className="journey" aria-label={`${(done * 100).toFixed(0)}% of the way from ${startKg} kg to ${targetKg} kg`}>
      <div className="track">
        <div className="fill" style={{ left: `${pos(startKg)}%`, right: `${100 - pos(currentKg)}%` }} />
      </div>
      <div className="mark" style={{ left: `${pos(startKg)}%` }}>Start<span className="num">{startKg} kg</span></div>
      <div className="mark" style={{ left: `${pos(targetKg)}%` }}>Target<span className="num">{targetKg} kg</span></div>
      <div className="mark low" style={{ left: `${pos(currentKg)}%` }}>
        <span className="num">{(done * 100).toFixed(0)}% there</span>
      </div>
      <span className="now" style={{ left: `${pos(currentKg)}%` }} />
    </div>
  );
};

const WeightChart = ({ logs, smoothed }: { logs: WeightLog[]; smoothed: SmoothedWeightPoint[] }) => {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const asc = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  const lastDay = asc.length ? dayNumber(asc[asc.length - 1].date) : 0;
  const pts = asc.filter((l) => lastDay - dayNumber(l.date) <= CHART_DAYS);
  const line = smoothed.filter((p) => lastDay - dayNumber(p.date) <= CHART_DAYS);
  const { w: W, h: H } = size;

  let body = null;
  if (W > 0 && pts.length >= 2) {
    const L = 44, R = 10, T = 10, B = 24;
    const d0 = dayNumber(pts[0].date), d1 = lastDay;
    const values = [...pts.map((p) => p.weight_kg), ...line.map((p) => p.ewma)];
    const ymin = Math.floor((Math.min(...values) - 0.03) * 10) / 10;
    const ymax = Math.ceil((Math.max(...values) + 0.03) * 10) / 10;
    const X = (iso: string) => L + ((dayNumber(iso) - d0) / (d1 - d0 || 1)) * (W - L - R);
    const Y = (v: number) => T + ((ymax - v) / (ymax - ymin)) * (H - T - B);
    const yStep = ymax - ymin > 1 ? 0.5 : ymax - ymin > 0.5 ? 0.2 : 0.1;
    const yTicks: number[] = [];
    for (let v = ymin; v <= ymax + 1e-9; v += yStep) yTicks.push(Math.round(v * 10) / 10);
    const xStep = W < 500 ? 14 : 7;
    const xTicks: string[] = [];
    for (let d = d0; d <= d1; d += xStep) xTicks.push(new Date(d * DAY_MS).toISOString().slice(0, 10));
    const path = line.map((p, i) => `${i ? "L" : "M"}${X(p.date).toFixed(1)},${Y(p.ewma).toFixed(1)}`).join("");

    body = (
      <>
        {yTicks.map((v) => (
          <g key={v}>
            <line className="grid" x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} />
            <text x={L - 8} y={Y(v) + 3.5} textAnchor="end">{v.toFixed(1)}</text>
          </g>
        ))}
        {xTicks.map((iso) => (
          <text key={iso} x={X(iso)} y={H - 6} textAnchor="middle">{formatDate(iso)}</text>
        ))}
        {line.length > 1 && (
          <>
            <path className="area" d={`${path}L${X(line[line.length - 1].date)},${H - B}L${X(line[0].date)},${H - B}Z`} />
            <path className="avg" d={path} />
          </>
        )}
        {pts.map((p) => (
          <circle key={p.id} className="pt" cx={X(p.date)} cy={Y(p.weight_kg)} r={3.8}>
            <title>{`${formatDate(p.date)}: ${p.weight_kg} kg`}</title>
          </circle>
        ))}
      </>
    );
  }

  return (
    <svg ref={ref} className="chart" viewBox={`0 0 ${W || 1} ${H || 1}`} role="img" aria-label="Weight over the last 8 weeks">
      {body}
    </svg>
  );
};

const WeightScreen = () => {
  const [logs, setLogs] = useState<WeightLog[] | null>(null);
  const [smoothed, setSmoothed] = useState<SmoothedWeightPoint[]>([]);
  const [targetKg, setTargetKg] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress>({
    weeklyLossRate: null,
    weeklyLossRateMargin: null,
    progressFlag: null,
    smoothedWeightKg: null,
  });
  const [date, setDate] = useState(todayIso());
  const [weightKg, setWeightKg] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { showToast, toastNode } = useToast();

  const refetchLogs = async () => {
    const [logsRes, smoothedRes] = await Promise.all([
      fetch("/api/weight"),
      fetch("/api/weight/smoothed"),
    ]);
    setLogs(await logsRes.json());
    if (smoothedRes.ok) setSmoothed(await smoothedRes.json());
  };

  const refetchStatus = async () => {
    const res = await fetch("/api/status");
    if (!res.ok) return;
    const body = await res.json();
    setProgress({
      weeklyLossRate: body.weeklyLossRate,
      weeklyLossRateMargin: body.weeklyLossRateMargin,
      progressFlag: body.progressFlag,
      smoothedWeightKg: body.smoothedWeightKg,
    });
  };

  const fetchProfile = async () => {
    const res = await fetch("/api/profile");
    if (!res.ok) return;
    const profile: CatProfile = await res.json();
    setTargetKg(profile.target_weight_kg);
  };

  useEffect(() => {
    refetchLogs();
    refetchStatus();
    fetchProfile();
  }, []);

  const kgNum = Number(weightKg.replace(",", "."));
  const kgValid = weightKg.trim() !== "" && kgNum > 0;

  const addEntry = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || !kgValid || !date) return;
    setError(null);
    setSubmitting(true);
    const res = await fetch("/api/weight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, weight_kg: kgNum, notes: notes || null }),
    }).finally(() => setSubmitting(false));
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Couldn't save that weigh-in. Try again.");
      return;
    }
    setProgress(body);
    setWeightKg("");
    setNotes("");
    showToast(`Saved ${kgNum} kg for ${formatDate(date)}`);
    await refetchLogs();
  };

  const latest = logs?.[0];
  const earliest = logs && logs.length > 0 ? logs[logs.length - 1] : undefined;
  const avg = progress.smoothedWeightKg;
  const showJourney =
    avg != null && targetKg != null && earliest != null && earliest.weight_kg > targetKg;

  return (
    <>
      <PageHeader eyebrow="Pre-breakfast weigh-ins" title="Weight" />

      {error && (
        <div className="banners">
          <Banner tone="bad" title="Error">{error}</Banner>
        </div>
      )}

      <div className="weight">
        <section className="card hero" aria-label="Progress">
          <div className="hero-top">
            <div>
              <div className="eyebrow">Smoothed weight</div>
              {avg != null ? (
                <>
                  <div className="kg">{avg.toFixed(2)}<small>kg</small></div>
                  <div className="sub">
                    {toLb(avg).toFixed(2)} lb
                    {latest &&
                      ` · last weigh-in ${latest.weight_kg} kg ${latest.date === todayIso() ? "today" : formatDate(latest.date)}`}
                  </div>
                </>
              ) : (
                <div className="sub">No weigh-ins yet</div>
              )}
            </div>
            <TrendChip progress={progress} />
          </div>
          {showJourney && (
            <Journey startKg={earliest!.weight_kg} targetKg={targetKg!} currentKg={avg!} />
          )}
        </section>

        <section className="card chart-card" aria-label="Weight chart">
          <div className="section-head">
            <h2>Last 8 weeks</h2>
            <div className="legend">
              <span><i className="l-raw" />Weigh-in</span>
              <span><i className="l-avg" />Smoothed</span>
            </div>
          </div>
          <WeightChart logs={logs ?? []} smoothed={smoothed} />
        </section>

        <form className="card entry-card" onSubmit={addEntry} aria-label="Add weigh-in">
          <h2>Add weigh-in</h2>
          <div className="lcd kg-lcd">
            <span className="mode-tag">kg</span>
            <div className="digits">
              <span className="ghost" aria-hidden="true">0.000</span>
              <input
                id="weight-kg"
                aria-label="Weight (kg)"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.000"
                value={weightKg}
                onChange={(e) => setWeightKg(e.currentTarget.value.replace(/[^0-9.,]/g, ""))}
              />
            </div>
            <div className="meta">
              <span>{kgValid ? `${toLb(kgNum).toFixed(2)} lb` : "— lb"}</span>
              <span>
                {kgValid && avg != null
                  ? `${kgNum < avg ? "−" : "+"}${Math.abs((kgNum - avg) * 1000).toFixed(0)} g vs smoothed`
                  : ""}
              </span>
            </div>
          </div>
          <div className="two">
            <div className="field">
              <label htmlFor="weight-date">Date</label>
              <input id="weight-date" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
            </div>
            <div className="field">
              <label htmlFor="weight-notes">Note</label>
              <input id="weight-notes" placeholder="Optional" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
            </div>
          </div>
          <button className="go" type="submit" disabled={submitting || !kgValid}>
            Save weigh-in
          </button>
        </form>

        <section className="card recent" aria-label="Recent weigh-ins">
          <div className="section-head">
            <h2>Recent</h2>
            <small>last {VISIBLE_WEIGHINS}</small>
          </div>
          {logs == null ? (
            <p className="loading">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="empty">No weigh-ins logged yet.</p>
          ) : (
            <ul className="entries">
              {logs.slice(0, VISIBLE_WEIGHINS).map((log, i) => {
                const prev = logs[i + 1];
                const delta = prev ? log.weight_kg - prev.weight_kg : null;
                const deltaClass = delta == null || delta === 0 ? "" : delta < 0 ? "down" : "up";
                return (
                  <li key={log.id} className="wrow">
                    <div className="d">
                      {formatDate(log.date, true)}
                      {log.notes && <small>{log.notes}</small>}
                    </div>
                    <span className={`delta ${deltaClass}`}>
                      {delta == null
                        ? ""
                        : `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta * 1000).toFixed(0)} g`}
                    </span>
                    <span className="w">{log.weight_kg.toFixed(3)}</span>
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

export default WeightScreen;
