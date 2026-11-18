import { NOTE_MARKDOWN_LIMIT, NOTE_TITLE_LIMIT } from "../shared/notes.ts";
import type { Note, NoteContent } from "../shared/notes.ts";
import { row, rows } from "./db.ts";
import type { D1Like } from "./db.ts";
import { HttpError, reqString } from "./validate.ts";
import type { Body } from "./validate.ts";

export function readNote(body: Body): NoteContent {
  const title = reqString(body, "title", NOTE_TITLE_LIMIT);
  const { markdown } = body;
  if (typeof markdown !== "string" || markdown.length > NOTE_MARKDOWN_LIMIT) {
    throw new HttpError(400, `Markdown must be text of at most ${NOTE_MARKDOWN_LIMIT} characters`);
  }
  return { title, markdown };
}

export function listNotes(db: D1Like): Promise<Note[]> {
  return rows<Note>(db, "SELECT * FROM notes ORDER BY updated_at DESC, id DESC");
}

export function createNote(db: D1Like, note: NoteContent, now: string) {
  return row<Note>(
    db, "INSERT INTO notes (title, markdown, updated_at) VALUES (?, ?, ?) RETURNING *",
    note.title, note.markdown, now,
  );
}

export async function updateNote(db: D1Like, id: number, note: NoteContent, now: string) {
  const saved = await row<Note>(
    db, "UPDATE notes SET title = ?, markdown = ?, updated_at = ? WHERE id = ? RETURNING *",
    note.title, note.markdown, now, id,
  );
  if (!saved) throw new HttpError(404, "Note not found");
  return saved;
}

export async function deleteNote(db: D1Like, id: number) {
  const result = await db.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
  if (!result.meta.changes) throw new HttpError(404, "Note not found");
}
