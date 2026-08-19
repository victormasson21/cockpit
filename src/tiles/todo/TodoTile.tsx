// TodoTile.tsx — tabbed to-do list: per-list TODO and DONE, plus a global IN PROGRESS section whose
// rows name their owning list. Persisted via the store.
import { useRef, useState } from "react";
import { Tile } from "../Tile";
import { useSettings } from "../../settings/store";
import { groupByState, resolveLists, activeListId, todosInList, listNameOf, canDeleteList } from "./todo";
import { CreateWorktreeButton } from "../../views/CreateWorktreeButton";
import type { TodoItem, TodoState } from "../../settings/types";
import "./todo.css";

// Status glyph per state; clicking it cycles to the next state.
const GLYPH: Record<TodoState, string> = { todo: "○", in_progress: "◐", done: "●" };

// Horizontal movement (px) before a tab press becomes a drag; under it, the press is a plain click.
const TAB_DRAG_THRESHOLD = 5;

export function TodoTile() {
  // One selector per field: a bare useSettings() would re-render this tile on every unrelated store write.
  const todos = useSettings((s) => s.cockpit.todos);
  const todoLists = useSettings((s) => s.cockpit.todoLists);
  const activeTodoListId = useSettings((s) => s.cockpit.activeTodoList);
  const addTodo = useSettings((s) => s.addTodo);
  const cycleTodo = useSettings((s) => s.cycleTodo);
  const removeTodo = useSettings((s) => s.removeTodo);
  const editTodo = useSettings((s) => s.editTodo);
  const reorderTodo = useSettings((s) => s.reorderTodo);
  const addTodoList = useSettings((s) => s.addTodoList);
  const renameTodoList = useSettings((s) => s.renameTodoList);
  const removeTodoList = useSettings((s) => s.removeTodoList);
  const reorderTodoList = useSettings((s) => s.reorderTodoList);
  const setActiveTodoList = useSettings((s) => s.setActiveTodoList);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // null = not adding a list; a string = the in-progress name draft. Same shape for renaming.
  const [newList, setNewList] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState(false); // session-only; DONE starts collapsed
  const [tabDraggingId, setTabDraggingId] = useState<string | null>(null);
  const [tabDragOverId, setTabDragOverId] = useState<string | null>(null);
  // The pressed tab + start x, before the drag threshold is crossed. A ref, not state: it must be
  // readable inside the same gesture's move events without re-rendering on every pointerdown.
  const tabPress = useRef<{ id: string; x: number } | null>(null);

  const lists = resolveLists(todoLists);
  const activeId = activeListId(todoLists, activeTodoListId);
  const backlog = todosInList(todos, todoLists, activeId, "todo");
  const done = todosInList(todos, todoLists, activeId, "done");
  const groups = groupByState(todos); // global bucket for IN PROGRESS

  const add = () => { const t = draft.trim(); if (!t) return; addTodo(t); setDraft(""); };
  const startEdit = (id: string, text: string) => { setEditingId(id); setEditDraft(text); };
  // Escape clears editingId first → the input unmounts; React 19 does NOT fire onBlur on unmount, and this
  // guard no-ops anyway once editingId is null, so Escape reliably discards the draft (no accidental save).
  const commitEdit = () => { if (editingId) editTodo(editingId, editDraft); setEditingId(null); };
  // Same unmount-before-blur reasoning as commitEdit: the null guard makes Escape a clean cancel.
  const commitNewList = () => { const t = (newList ?? "").trim(); if (t) addTodoList(t); setNewList(null); };
  const commitRename = () => { if (renameDraft !== null) renameTodoList(activeId, renameDraft); setRenameDraft(null); };

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

  // Tab drag: same pointer-event idiom as the rows, but started from the tab itself with a small
  // movement threshold, so a plain click still switches/renames. Once the threshold is crossed we
  // capture the pointer — capture also retargets the eventual click to the wrapper span, which is
  // what stops the tab button's onClick from ALSO firing after a drag.
  const onTabDown = (id: string) => (e: React.PointerEvent) => {
    if (renameDraft !== null && id === activeId) return; // renaming in place — leave the input alone
    tabPress.current = { id, x: e.clientX };
  };
  const onTabMove = (e: React.PointerEvent) => {
    const press = tabPress.current;
    if (!press) return;
    // A press released off the tab bar (no capture yet) never reaches onTabUp; without this guard the
    // stale press would turn a later buttonless hover across the bar into a drag that can't end.
    if (e.buttons === 0) { tabPress.current = null; return; }
    if (!tabDraggingId) {
      if (Math.abs(e.clientX - press.x) < TAB_DRAG_THRESHOLD) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setTabDraggingId(press.id);
    }
    const tab = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-list-id]");
    const id = tab?.getAttribute("data-list-id") ?? null;
    setTabDragOverId(id === press.id ? null : id);
  };
  const onTabUp = () => {
    if (tabDraggingId && tabDragOverId) reorderTodoList(tabDraggingId, tabDragOverId);
    tabPress.current = null;
    setTabDraggingId(null);
    setTabDragOverId(null);
  };

  // One row shape for all three sections; `tag` names the owning list and is passed only by the
  // cross-list sections (the TODO section shows one list, so a prefix there would be noise).
  const row = (t: TodoItem, tag?: string) => (
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
      {tag && <span className="todo__list-tag">{tag}</span>}
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
  );

  return (
    <Tile title="TO DO" icon={<span>☑</span>}>
      <div className="todo">
        {/* Tab bar: click a tab to switch, click the ACTIVE tab's name to rename it, ✕ deletes an emptied one. */}
        <nav className="todo__tabs">
          {lists.map((l) => (
            <span
              key={l.id}
              data-list-id={l.id}
              className={`todo__tab${l.id === activeId ? " todo__tab--active" : ""}${tabDragOverId === l.id ? " todo__tab--drop-target" : ""}`}
              onPointerDown={onTabDown(l.id)}
              onPointerMove={onTabMove}
              onPointerUp={onTabUp}
            >
              {renameDraft !== null && l.id === activeId ? (
                <input
                  className="todo__tab-edit"
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenameDraft(null);
                  }}
                />
              ) : (
                <button
                  className="todo__tab-name"
                  onClick={() => (l.id === activeId ? setRenameDraft(l.name) : setActiveTodoList(l.id))}
                  title={l.id === activeId ? "Click to rename" : `Switch to ${l.name}`}
                >{l.name}</button>
              )}
              {l.id === activeId && canDeleteList(todoLists, todos, l.id) && (
                <button className="todo__tab-del" aria-label="delete list" title="Delete this list" onClick={() => removeTodoList(l.id)}>✕</button>
              )}
            </span>
          ))}
          {newList === null ? (
            <button className="todo__tab-add" aria-label="new list" title="New list" onClick={() => setNewList("")}>+</button>
          ) : (
            <input
              className="todo__tab-edit"
              autoFocus
              placeholder="List name…"
              value={newList}
              onChange={(e) => setNewList(e.target.value)}
              onBlur={commitNewList}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitNewList();
                if (e.key === "Escape") setNewList(null);
              }}
            />
          )}
        </nav>

        {todos.length === 0 && <div className="todo__empty">No todos yet</div>}

        {/* Active list's backlog + the add input (which adds to this list). */}
        <div className="todo__section">
          <div className="todo__section-label">TODO</div>
          {backlog.map((t) => row(t))}
          <input className="todo__add" placeholder="Add a to-do…" value={draft}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        </div>

        {/* Global: everything in flight, whichever list owns it. */}
        {groups.in_progress.length > 0 && (
          <div className="todo__section">
            <div className="todo__section-label">IN PROGRESS</div>
            {groups.in_progress.map((t) => row(t, listNameOf(t, todoLists)))}
          </div>
        )}

        {/* Per-tab like TODO, collapsed by default so finished work never crowds the tile. */}
        {done.length > 0 && (
          <div className="todo__section">
            <button className="todo__section-toggle" onClick={() => setDoneOpen(!doneOpen)}>
              DONE ({done.length}) {doneOpen ? "▾" : "▸"}
            </button>
            {doneOpen && done.map((t) => row(t))}
          </div>
        )}
      </div>
    </Tile>
  );
}
