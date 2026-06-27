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
