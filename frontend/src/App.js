import React, { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const STORAGE_KEY = "pnm.notes.v1";

/**
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} title
 * @property {string} content
 * @property {number} updatedAt
 * @property {number} createdAt
 */

/**
 * Create a stable-ish id without external deps.
 * @returns {string}
 */
function createId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {string} content
 * @returns {string}
 */
function makeTitleFromContent(content) {
  const firstLine = (content || "").split("\n")[0].trim();
  if (firstLine.length === 0) return "Untitled note";
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}

/**
 * @param {Note[]} notes
 * @returns {Note[]}
 */
function sortNotes(notes) {
  return [...notes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/**
 * Load notes from localStorage.
 * @returns {Note[]}
 */
function loadNotesFromStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((n) => n && typeof n.id === "string")
      .map((n) => ({
        id: n.id,
        title: typeof n.title === "string" ? n.title : "Untitled note",
        content: typeof n.content === "string" ? n.content : "",
        updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : Date.now(),
        createdAt: typeof n.createdAt === "number" ? n.createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

/**
 * Save notes to localStorage.
 * @param {Note[]} notes
 */
function saveNotesToStorage(notes) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    // If storage is unavailable (private mode / quota), we silently fail but keep app usable in-memory.
  }
}

/**
 * Seed a couple of notes for first-time users.
 * @returns {Note[]}
 */
function seedNotes() {
  const now = Date.now();
  const n1 = {
    id: createId(),
    title: "Welcome to Personal Notes",
    content:
      "Write anything here.\n\nTips:\n• Use the sidebar to switch notes\n• Create a new note with the + button\n• Your notes are saved locally in this browser",
    createdAt: now - 1000 * 60 * 60,
    updatedAt: now - 1000 * 60 * 60,
  };
  const n2 = {
    id: createId(),
    title: "Ocean Professional theme",
    content:
      "Primary: #2563EB (blue)\nSecondary: #F59E0B (amber)\n\nThis UI uses subtle shadows, rounded corners, and smooth transitions.",
    createdAt: now - 1000 * 20,
    updatedAt: now - 1000 * 20,
  };
  return sortNotes([n1, n2]);
}

/**
 * Optional API integration (if REACT_APP_API_BASE is set).
 * If not set, operations are handled purely with localStorage.
 *
 * NOTE: This keeps the app functional even without a backend.
 */
const API_BASE = (process.env.REACT_APP_API_BASE || "").trim();

/**
 * @param {AbortSignal} signal
 * @returns {Promise<Note[] | null>} notes when API is available; null when not configured/failed
 */
async function tryFetchNotesFromApi(signal) {
  if (!API_BASE) return null;
  try {
    const res = await fetch(`${API_BASE.replace(/\/$/, "")}/notes`, { signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;
    return data.map((n) => ({
      id: String(n.id),
      title: typeof n.title === "string" ? n.title : "Untitled note",
      content: typeof n.content === "string" ? n.content : "",
      createdAt: typeof n.createdAt === "number" ? n.createdAt : Date.now(),
      updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : Date.now(),
    }));
  } catch {
    return null;
  }
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// PUBLIC_INTERFACE
function App() {
  const [notes, setNotes] = useState(() => {
    const stored = loadNotesFromStorage();
    if (stored.length > 0) return sortNotes(stored);
    const seeded = seedNotes();
    saveNotesToStorage(seeded);
    return seeded;
  });

  const [selectedId, setSelectedId] = useState(() => (notes[0] ? notes[0].id : null));
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) || null,
    [notes, selectedId]
  );

  // Editor state (controlled), to support smooth autosave/debounce.
  const [draftTitle, setDraftTitle] = useState(selectedNote?.title || "");
  const [draftContent, setDraftContent] = useState(selectedNote?.content || "");

  const lastSavedRef = useRef({ title: draftTitle, content: draftContent, noteId: selectedId });

  // Load from API if configured (best-effort) but keep local storage fallback.
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const apiNotes = await tryFetchNotesFromApi(controller.signal);
      if (apiNotes && apiNotes.length >= 0) {
        const sorted = sortNotes(apiNotes);
        setNotes(sorted);
        setSelectedId((prev) => prev || (sorted[0] ? sorted[0].id : null));
        saveNotesToStorage(sorted);
      }
    })();
    return () => controller.abort();
  }, []);

  // Keep selection valid when notes change (e.g., deleted).
  useEffect(() => {
    if (selectedId && notes.some((n) => n.id === selectedId)) return;
    setSelectedId(notes[0]?.id || null);
  }, [notes, selectedId]);

  // When selection changes, reset draft.
  useEffect(() => {
    setDraftTitle(selectedNote?.title || "");
    setDraftContent(selectedNote?.content || "");
    lastSavedRef.current = {
      title: selectedNote?.title || "",
      content: selectedNote?.content || "",
      noteId: selectedNote?.id || null,
    };
  }, [selectedNote?.id]); // intentionally keyed on id only

  // Persist notes to localStorage.
  useEffect(() => {
    saveNotesToStorage(notes);
  }, [notes]);

  // Autosave draft into notes (debounced).
  useEffect(() => {
    if (!selectedNote) return;

    const current = { title: draftTitle, content: draftContent, noteId: selectedNote.id };
    const lastSaved = lastSavedRef.current;

    // Nothing changed.
    if (
      current.noteId === lastSaved.noteId &&
      current.title === lastSaved.title &&
      current.content === lastSaved.content
    ) {
      return;
    }

    const t = window.setTimeout(() => {
      setNotes((prev) => {
        const idx = prev.findIndex((n) => n.id === selectedNote.id);
        if (idx === -1) return prev;

        const content = current.content;
        const title = (current.title || "").trim() || makeTitleFromContent(content);

        const updated = {
          ...prev[idx],
          title,
          content,
          updatedAt: Date.now(),
        };

        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)];
        return sortNotes(next);
      });

      lastSavedRef.current = current;
    }, 350);

    return () => window.clearTimeout(t);
  }, [draftTitle, draftContent, selectedNote]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter((n) => {
      const hay = `${n.title}\n${n.content}`.toLowerCase();
      return hay.includes(q);
    });
  }, [notes, query]);

  // PUBLIC_INTERFACE
  const createNewNote = () => {
    const now = Date.now();
    const id = createId();
    const newNote = {
      id,
      title: "Untitled note",
      content: "",
      createdAt: now,
      updatedAt: now,
    };

    setNotes((prev) => sortNotes([newNote, ...prev]));
    setSelectedId(id);
    setSidebarOpen(false);
  };

  // PUBLIC_INTERFACE
  const deleteNote = (id) => {
    const note = notes.find((n) => n.id === id);
    const ok = window.confirm(`Delete "${note?.title || "this note"}"? This cannot be undone.`);
    if (!ok) return;

    setNotes((prev) => prev.filter((n) => n.id !== id));
    setSidebarOpen(false);
  };

  // PUBLIC_INTERFACE
  const selectNote = (id) => {
    setSelectedId(id);
    setSidebarOpen(false);
  };

  const emptyState = notes.length === 0;

  return (
    <div className="pnm">
      <header className="pnm-header">
        <div className="pnm-header__left">
          <button
            className="icon-btn pnm-header__menuBtn"
            type="button"
            onClick={() => setSidebarOpen((s) => !s)}
            aria-label={sidebarOpen ? "Close notes list" : "Open notes list"}
            aria-expanded={sidebarOpen}
          >
            <span aria-hidden="true">☰</span>
          </button>

          <div className="pnm-brand">
            <div className="pnm-brand__title">Personal Notes</div>
            <div className="pnm-brand__subtitle">
              {API_BASE ? "Connected to API (best effort)" : "Saved locally in your browser"}
            </div>
          </div>
        </div>

        <div className="pnm-header__right">
          <div className="pnm-search">
            <input
              className="pnm-search__input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              aria-label="Search notes"
            />
          </div>

          <button className="btn btn-primary" type="button" onClick={createNewNote}>
            + New note
          </button>
        </div>
      </header>

      <div className="pnm-body">
        <aside className={`pnm-sidebar ${sidebarOpen ? "is-open" : ""}`} aria-label="Notes list">
          <div className="pnm-sidebar__header">
            <div className="pnm-sidebar__title">Notes</div>
            <button className="btn btn-secondary btn-small" type="button" onClick={createNewNote}>
              + Create
            </button>
          </div>

          <div className="pnm-sidebar__list" role="list">
            {filteredNotes.length === 0 ? (
              <div className="pnm-emptyList">
                <div className="pnm-emptyList__title">No matches</div>
                <div className="pnm-emptyList__desc">Try a different search.</div>
              </div>
            ) : (
              filteredNotes.map((n) => {
                const active = n.id === selectedId;
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`pnm-noteCard ${active ? "is-active" : ""}`}
                    onClick={() => selectNote(n.id)}
                    role="listitem"
                    aria-current={active ? "true" : "false"}
                  >
                    <div className="pnm-noteCard__row">
                      <div className="pnm-noteCard__title">{n.title || "Untitled note"}</div>
                      <div className="pnm-noteCard__time">{formatTime(n.updatedAt)}</div>
                    </div>
                    <div className="pnm-noteCard__preview">
                      {(n.content || "").trim() ? (n.content || "").trim() : "No content"}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="pnm-main" aria-label="Note editor">
          {emptyState ? (
            <div className="pnm-blank">
              <div className="pnm-blank__title">No notes yet</div>
              <div className="pnm-blank__desc">
                Create your first note to start writing. Notes are stored locally in this browser.
              </div>
              <button className="btn btn-primary btn-large" type="button" onClick={createNewNote}>
                + Create new note
              </button>
            </div>
          ) : selectedNote ? (
            <div className="pnm-editor">
              <div className="pnm-editor__toolbar">
                <div className="pnm-editor__meta">
                  <div className="pnm-editor__metaLine">
                    <span className="pill">Updated</span>
                    <span className="metaText">{formatTime(selectedNote.updatedAt)}</span>
                  </div>
                  <div className="pnm-editor__metaLine">
                    <span className="pill pill--soft">Created</span>
                    <span className="metaText">{formatTime(selectedNote.createdAt)}</span>
                  </div>
                </div>

                <div className="pnm-editor__actions">
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={() => deleteNote(selectedNote.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <label className="pnm-field">
                <span className="pnm-field__label">Title</span>
                <input
                  className="pnm-input"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="Note title"
                />
              </label>

              <label className="pnm-field pnm-field--grow">
                <span className="pnm-field__label">Content</span>
                <textarea
                  className="pnm-textarea"
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  placeholder="Start writing…"
                />
              </label>
            </div>
          ) : (
            <div className="pnm-blank">
              <div className="pnm-blank__title">Select a note</div>
              <div className="pnm-blank__desc">Choose one from the list, or create a new note.</div>
              <button className="btn btn-primary btn-large" type="button" onClick={createNewNote}>
                + Create new note
              </button>
            </div>
          )}

          <button className="fab" type="button" onClick={createNewNote} aria-label="Create new note">
            +
          </button>
        </main>
      </div>
    </div>
  );
}

export default App;
