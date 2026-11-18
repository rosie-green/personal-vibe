import { useState } from "react";
import type { SubmitEvent } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { NOTE_MARKDOWN_LIMIT, NOTE_TITLE_LIMIT } from "../shared/notes.ts";
import type { NoteContent } from "../shared/notes.ts";
import { api } from "./api.ts";
import { Banner, ErrorBanner, Field, Segmented, plural, useLoad } from "./ui.tsx";

const EMPTY_NOTE: NoteContent = { title: "", markdown: "" };
const MODES = [{ value: "write", label: "Write" }, { value: "preview", label: "Preview" }] as const;
const excerptComponents: Components = {
  a: ({ children }) => <span>{children}</span>,
  img: ({ alt }) => alt ? <span>{alt}</span> : null,
};
const excerptExcludedElements = ["section", "sup"];

function NoteBody({ markdown, excerpt = false }: { markdown: string; excerpt?: boolean }) {
  return (
    <div className={excerpt ? "markdown note-excerpt" : "markdown"} inert={excerpt || undefined}>
      {markdown.trim() ? (
        <Markdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={excerpt ? excerptComponents : undefined}
          disallowedElements={excerpt ? excerptExcludedElements : undefined}
        >
          {markdown}
        </Markdown>
      ) : <p className="muted">This note is empty.</p>}
    </div>
  );
}

export function Notes() {
  const { data: notes, setData, loading, error, reload } = useLoad(api.notes, []);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<NoteContent | null>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const note = notes?.find((item) => item.id === selected);
  const remaining = Math.max(0, NOTE_MARKDOWN_LIMIT - (draft?.markdown.length ?? 0));

  function startEditing(content: NoteContent) {
    setActionError(null);
    setMode("write");
    setDraft(content);
  }

  async function run(action: () => Promise<void>) {
    setPending(true);
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  function save(event: SubmitEvent) {
    event.preventDefault();
    if (pending || !draft?.title.trim()) return;
    const content = { title: draft.title, markdown: draft.markdown };
    void run(async () => {
      const saved = note ? await api.updateNote(note.id, content) : await api.createNote(content);
      setData((previous) => [saved, ...(previous ?? []).filter((item) => item.id !== saved.id)]);
      setSelected(saved.id);
      setDraft(null);
    });
  }

  return (
    <section>
      <div className="page-head">
        <h1>Notes</h1>
        {!note && !draft && notes ? (
          <button className="btn btn-primary" onClick={() => startEditing(EMPTY_NOTE)}>New note</button>
        ) : null}
      </div>

      {loading && !notes ? <p className="muted center pad">Loading notes…</p> : null}
      {error ? <ErrorBanner error={error} onRetry={reload} /> : null}
      {actionError ? <Banner kind="error">{actionError}</Banner> : null}

      {draft ? (
        <div className="panel">
          <h2 className="panel-title">{note ? "Edit note" : "New note"}</h2>
          <form className="form" onSubmit={save}>
            <Field label="Title">
              <input value={draft.title} maxLength={NOTE_TITLE_LIMIT} autoFocus required disabled={pending}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </Field>
            <Segmented value={mode} options={MODES} onChange={setMode} label="Markdown editor mode" />
            <div hidden={mode !== "write"}>
              <Field label="Markdown" hint={`${remaining.toLocaleString()} ${plural("character", remaining)} remaining`}>
                <textarea className="note-editor" rows={10} value={draft.markdown} maxLength={NOTE_MARKDOWN_LIMIT}
                  disabled={pending} onChange={(event) => setDraft({ ...draft, markdown: event.target.value })} />
              </Field>
            </div>
            {mode === "preview" ? <NoteBody markdown={draft.markdown} /> : null}
            <div className="form-actions">
              <button className="btn btn-primary" disabled={pending || !draft.title.trim()}>
                {pending ? "Saving…" : "Save note"}
              </button>
              <button type="button" className="btn" disabled={pending} onClick={() => {
                setDraft(null);
                setActionError(null);
              }}>Cancel</button>
            </div>
          </form>
        </div>
      ) : note ? (
        <>
          <button className="btn" disabled={pending} onClick={() => {
            setSelected(null);
            setActionError(null);
          }}>Back to notes</button>
          <article className="panel note-view">
            <h2>{note.title}</h2>
            <NoteBody markdown={note.markdown} />
            <div className="form-actions">
              <button className="btn" disabled={pending} onClick={() => startEditing(note)}>Edit note</button>
              <button className="btn" disabled={pending} onClick={() => {
                if (!confirm(`Delete "${note.title}"?`)) return;
                void run(async () => {
                  await api.deleteNote(note.id);
                  setData((previous) => (previous ?? []).filter((item) => item.id !== note.id));
                  setSelected(null);
                });
              }}>{pending ? "Deleting…" : "Delete note"}</button>
            </div>
          </article>
        </>
      ) : notes?.length ? (
        <ul className="item-list">
          {notes.map((item) => (
            <li key={item.id} className="item note-list-item">
              <button className="note-open" onClick={() => setSelected(item.id)}>{item.title}</button>
              <NoteBody markdown={item.markdown} excerpt />
            </li>
          ))}
        </ul>
      ) : notes ? <p className="muted hint">No notes yet. Create one to start writing.</p> : null}
    </section>
  );
}
