// TodoTile.tsx — local 3-state to-do list (todo/in_progress/done), persisted via the store.
import { useState } from "react";
import { Tile } from "../Tile";
import { useSettings } from "../../settings/store";
import { groupByState } from "./todo";
import { CreateWorktreeButton } from "../../views/CreateWorktreeButton";
import type { TodoState } from "../../settings/types";
import "./todo.css";

const SECTIONS: { state: TodoState; label: string }[] = [
  { state: "todo", label: "TODO" },
  { state: "in_progress", label: "IN PROGRESS" },
  { state: "done", label: "DONE" },
];
// Status glyph per state; clicking it cycles to the next state.
const GLYPH: Record<TodoState, string> = { todo: "○", in_progress: "◐", done: "●" };

export function TodoTile() {
  const { cockpit, addTodo, cycleTodo, removeTodo, editTodo, reorderTodo } = useSettings();
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const groups = groupByState(cockpit.todos);

  const add = () => { const t = draft.trim(); if (!t) return; addTodo(t); setDraft(""); };
  const startEdit = (id: string, text: string) => { setEditingId(id); setEditDraft(text); };
  // Escape clears editingId first → the input unmounts; React 19 does NOT fire onBlur on unmount, and this
  // guard no-ops anyway once editingId is null, so Escape reliably discards the draft (no accidental save).
  const commitEdit = () => { if (editingId) editTodo(editingId, editDraft); setEditingId(null); };

  // Pointer-event drag, started only from the ⋮⋮ handle. HTML5 DnD is unavailable app-wide once
  // Tauri's native drag-drop owns file drops, so we capture the pointer and hit-test rows manually.
  // A dedicated handle (rather than a whole-row drag) keeps the glyph-click and text-click unambiguous.
  const onHandleDown = (id: string) => (e: React.PointerEvent) => {
    e.preventDefault(); // suppress text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingId(id);
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!draggingId) return;
    // Pointer capture routes moves to the handle, so hit-test the real cursor position for the row.
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-todo-id]");
    const id = row?.getAttribute("data-todo-id") ?? null;
    setDragOverId(id === draggingId ? null : id);
  };
  const onHandleUp = () => {
    if (draggingId && dragOverId) reorderTodo(draggingId, dragOverId);
    setDraggingId(null);
    setDragOverId(null);
  };

  return (
    <Tile title="TO DO" icon={<span>☑</span>}>
      <div className="todo">
        {cockpit.todos.length === 0 && <div className="todo__empty">No todos yet</div>}
        {SECTIONS.map(({ state, label }) =>
          groups[state].length === 0 ? null : (
            <div key={state} className="todo__section">
              <div className="todo__section-label">{label}</div>
              {groups[state].map((t) => (
                <div
                  key={t.id}
                  data-todo-id={t.id}
                  className={`todo__row todo__row--${t.state}${dragOverId === t.id ? " todo__row--drop-target" : ""}`}
                >
                  {/* span, not button: no keyboard affordance to preserve, and a span carries no implicit tab stop */}
                  <span
                    className="todo__handle"
                    onPointerDown={editingId === t.id ? undefined : onHandleDown(t.id)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                  >⋮⋮</span>
                  <button className="todo__glyph" aria-label="cycle state" onClick={() => cycleTodo(t.id)}>{GLYPH[t.state]}</button>
                  {editingId === t.id ? (
                    <input
                      className="todo__edit"
                      autoFocus
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="todo__text" onClick={() => startEdit(t.id, t.text)}>{t.text}</span>
                  )}
                  <CreateWorktreeButton source="todo" view="cockpit" getInput={() => t.text} title="Create worktree from this to-do" />
                  <button className="todo__del" aria-label="delete" onClick={() => removeTodo(t.id)}>✕</button>
                </div>
              ))}
            </div>
          )
        )}
        <input className="todo__add" placeholder="Add a to-do…" value={draft}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      </div>
    </Tile>
  );
}
