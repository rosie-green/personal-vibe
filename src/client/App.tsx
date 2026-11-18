import { useCallback, useEffect, useState } from "react";
import { Calendar } from "./Calendar.tsx";
import { todayLocal } from "./dates.ts";
import { Medicines } from "./Medicines.tsx";
import { Notes } from "./Notes.tsx";
import { Tasks } from "./Tasks.tsx";
import { Today } from "./Today.tsx";
import { Emoji, StarIcon } from "./ui.tsx";

type Tab = "today" | "calendar" | "medicines" | "tasks" | "notes";
const TABS: Tab[] = ["today", "calendar", "medicines", "tasks", "notes"];

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

const ICONS: Record<Tab, string> = { today: "🗃️", calendar: "📅", medicines: "💊", tasks: "📝", notes: "📓" };

const LABELS: Record<Tab, string> = { today: "Today", calendar: "Calendar", medicines: "Medicines", tasks: "Tasks", notes: "Notes" };

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
        {tab === "notes" ? <Notes /> : null}
      </main>

      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <button key={t} className={t === tab ? "tab tab-on" : "tab"} onClick={() => setTab(t)} aria-current={t === tab ? "page" : undefined}>
            <Emoji symbol={ICONS[t]} size={22} />
            <span>{LABELS[t]}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
