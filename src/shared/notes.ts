export const NOTE_TITLE_LIMIT = 120;
export const NOTE_MARKDOWN_LIMIT = 5_000;

export interface NoteContent {
  title: string;
  markdown: string;
}

export interface Note extends NoteContent {
  id: number;
  updated_at: string;
}
