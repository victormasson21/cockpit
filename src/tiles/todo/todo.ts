// todo.ts — pure helpers for the To Do tile: state cycling + grouping by state.
import type { TodoItem, TodoState } from "../../settings/types";

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
