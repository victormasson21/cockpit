// TodoTile.tsx — local 3-state to-do list (todo/in_progress/done), persisted via the store.
import { useState } from "react";
import { Tile } from "../Tile";
import { useSettings } from "../../settings/store";
import { groupByState } from "./todo";
import type { TodoState } from "../../settings/types";
import "./todo.css";

const SECTIONS: { state: TodoState; label: string }[] = [
  { state: "todo", label: "TODO" },
  { state: "in_progress", label: "IN PROGRESS" },
  { state: "done", label: "DONE" },
];
// Status glyph per state; clicking it cycles to the next state.
const GLYPH: Record<TodoState, string> = { todo: "○", in_progress: "◐", done: "✅" };

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
                  className={`todo__row todo__row--${t.state}${dragOverId === t.id ? " todo__row--drop-target" : ""}`}
                  draggable={editingId !== t.id}
                  onDragStart={() => setDraggingId(t.id)}
                  onDragOver={(e) => { e.preventDefault(); if (t.id !== draggingId) setDragOverId(t.id); }}
                  onDragLeave={() => setDragOverId((cur) => (cur === t.id ? null : cur))}
                  onDrop={() => { if (draggingId) reorderTodo(draggingId, t.id); setDraggingId(null); setDragOverId(null); }}
                  onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                >
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
