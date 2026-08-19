// todo.ts — pure helpers for the To Do tile: state cycling, grouping by state, and list (tab) resolution.
import type { TodoItem, TodoList, TodoState } from "../../settings/types";

const ORDER: TodoState[] = ["todo", "in_progress", "done"];

// Click cycles todo → in_progress → done → todo (wraps, so a done item can be reopened).
export function nextState(s: TodoState): TodoState {
  return ORDER[(ORDER.indexOf(s) + 1) % ORDER.length];
}

// Bucket items by state, preserving input order within each bucket.
export function groupByState(items: TodoItem[]): Record<TodoState, TodoItem[]> {
  const groups: Record<TodoState, TodoItem[]> = { todo: [], in_progress: [], done: [] };
  for (const it of items) groups[it.state].push(it);
  return groups;
}

// Move draggedId to targetId's position, but ONLY within one section: reorder is a
// no-op unless both ids exist and share the same state (cross-section drops change
// nothing — state changes are the glyph-click's job). Returns a new array.
export function reorderWithinState(
  items: TodoItem[],
  draggedId: string,
  targetId: string,
): TodoItem[] {
  const draggedIdx = items.findIndex((i) => i.id === draggedId);
  const targetIdx = items.findIndex((i) => i.id === targetId);
  const dragged = draggedIdx >= 0 ? items[draggedIdx] : null;
  const target = targetIdx >= 0 ? items[targetIdx] : null;
  if (!dragged || !target || dragged.id === target.id || dragged.state !== target.state) {
    return [...items];
  }
  const without = items.filter((i) => i.id !== draggedId);
  const newTargetIdx = without.findIndex((i) => i.id === targetId);
  // If moving down (draggedIdx < targetIdx), insert after; if moving up, insert at.
  const insertIdx = draggedIdx < targetIdx ? newTargetIdx + 1 : newTargetIdx;
  without.splice(insertIdx, 0, dragged);
  return without;
}

// The list a pre-tabs config resolves into: one tab holding every existing item. Materialised into
// `todoLists` only when the user first adds a list or a to-do (see the store) — never on load.
export const DEFAULT_LIST: TodoList = { id: "default", name: "General" };

// Always yields at least one list. An empty `todoLists` means "pre-tabs file", NOT "the user wants zero
// tabs" — a tile with no tab has nowhere to put an item.
export function resolveLists(lists: TodoList[]): TodoList[] {
  return lists.length ? lists : [DEFAULT_LIST];
}

// The active tab, defaulting to the first list. Covers both a config that never had one and one naming
// a list since deleted.
export function activeListId(lists: TodoList[], active?: string): string {
  const resolved = resolveLists(lists);
  return resolved.some((l) => l.id === active) ? (active as string) : resolved[0].id;
}

// An item's effective list. An absent or dangling listId falls back to the first list, so an item can
// never become unreachable by deleting a list out from under it.
export function listIdOf(item: TodoItem, lists: TodoList[]): string {
  const resolved = resolveLists(lists);
  return resolved.some((l) => l.id === item.listId) ? (item.listId as string) : resolved[0].id;
}

// Display name for the row prefix in the cross-list IN PROGRESS / DONE sections.
export function listNameOf(item: TodoItem, lists: TodoList[]): string {
  const id = listIdOf(item, lists);
  return resolveLists(lists).find((l) => l.id === id)!.name;
}

// One list's items in one state, input order preserved (TODO and DONE are both per-tab).
export function todosInList(items: TodoItem[], lists: TodoList[], listId: string, state: TodoState): TodoItem[] {
  return items.filter((i) => i.state === state && listIdOf(i, lists) === listId);
}

// Move draggedId to targetId's slot in the tab bar; no-op unless both ids exist and differ.
// Same insert semantics as reorderWithinState: insert-after on move-right, insert-at on move-left.
export function reorderLists(lists: TodoList[], draggedId: string, targetId: string): TodoList[] {
  const draggedIdx = lists.findIndex((l) => l.id === draggedId);
  const targetIdx = lists.findIndex((l) => l.id === targetId);
  if (draggedIdx < 0 || targetIdx < 0 || draggedIdx === targetIdx) return [...lists];
  const without = lists.filter((l) => l.id !== draggedId);
  const newTargetIdx = without.findIndex((l) => l.id === targetId);
  const insertIdx = draggedIdx < targetIdx ? newTargetIdx + 1 : newTargetIdx;
  without.splice(insertIdx, 0, lists[draggedIdx]);
  return without;
}

// A list is deletable only when it holds nothing (in any state) and isn't the last one standing. This is
// the entire safety story for deletion: no confirm dialog, and no path that silently drops items.
export function canDeleteList(lists: TodoList[], items: TodoItem[], id: string): boolean {
  const resolved = resolveLists(lists);
  if (resolved.length <= 1 || !resolved.some((l) => l.id === id)) return false;
  return !items.some((i) => listIdOf(i, lists) === id);
}
