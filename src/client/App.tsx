import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Calendar } from "./Calendar.tsx";
import { todayLocal } from "./dates.ts";
import { Medicines } from "./Medicines.tsx";
import { Tasks } from "./Tasks.tsx";
import { Today } from "./Today.tsx";
import { StarIcon } from "./ui.tsx";

type Tab = "today" | "calendar" | "medicines" | "tasks";
const TABS: Tab[] = ["today", "calendar", "medicines", "tasks"];

function tabFromHash(): Tab {
  const h = location.hash.replace("#", "");
  return (TABS as string[]).includes(h) ? (h as Tab) : "today";
}

/** The local calendar day, kept fresh so the app rolls over at midnight even if left open. */
function useToday(): string {
  const [today, setToday] = useState(() => todayLocal());
  useEffect(() => {
    const refresh = () => setToday(todayLocal());
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return today;
}

const ICONS: Record<Tab, ReactNode> = {
  today: <path d="M4 12.5l5 5L20 6.5" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  medicines: (
    <>
      <rect x="3" y="9" width="18" height="6.5" rx="3.25" transform="rotate(-35 12 12.25)" />
      <path d="M9.6 8.7l4.8 6.6" />
    </>
  ),
  tasks: <path d="M8 6.5h12M8 12h12M8 17.5h12M3.8 6.5h.01M3.8 12h.01M3.8 17.5h.01" />,
};

const LABELS: Record<Tab, string> = { today: "Today", calendar: "Calendar", medicines: "Medicines", tasks: "Tasks" };

export function App() {
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [stars, setStars] = useState<number | null>(null);
  const today = useToday();

  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const setTab = useCallback((t: Tab) => {
    location.hash = t === "today" ? "" : t;
    setTabState(t);
    window.scrollTo({ top: 0 });
  }, []);

  const onStars = useCallback((n: number) => setStars(n), []);

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">My Day</span>
        {stars !== null ? (
          <span key={stars} className="star-count" aria-label={`${stars} golden stars`}>
            <StarIcon size={20} /> {stars}
          </span>
        ) : null}
      </header>

      <main className="content">
        {tab === "today" ? <Today today={today} onStars={onStars} goTo={setTab} /> : null}
        {tab === "calendar" ? <Calendar today={today} onStars={onStars} /> : null}
        {tab === "medicines" ? <Medicines today={today} /> : null}
        {tab === "tasks" ? <Tasks today={today} /> : null}
      </main>

      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? "tab tab-on" : "tab"} onClick={() => setTab(t)} aria-current={t === tab ? "page" : undefined}>
            <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className="tab-icon">
              {ICONS[t]}
            </svg>
            <span>{LABELS[t]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
