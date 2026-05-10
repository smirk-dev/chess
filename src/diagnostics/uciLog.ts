/**
 * A small, capped, subscribable log of UCI traffic and engine lifecycle events. The DiagnosticsPanel
 * renders it; it's also handy when debugging "did we send the right position?" / "was the engine
 * ready before we searched?". Capped so a long game never grows it without bound.
 */
export type UciLogDirection = 'in' | 'out' | 'event';

export interface UciLogEntry {
  id: number;
  at: number; // performance.now()
  dir: UciLogDirection;
  text: string;
}

const MAX_ENTRIES = 400;

let nextId = 1;
let entries: UciLogEntry[] = [];
const listeners = new Set<(entries: readonly UciLogEntry[]) => void>();

function emit(): void {
  const snapshot = entries.slice();
  for (const l of listeners) l(snapshot);
}

export function uciLogPush(dir: UciLogDirection, text: string): void {
  entries.push({ id: nextId++, at: typeof performance !== 'undefined' ? performance.now() : Date.now(), dir, text });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
  emit();
}

export function uciLogClear(): void {
  entries = [];
  emit();
}

export function uciLogGet(): readonly UciLogEntry[] {
  return entries.slice();
}

export function uciLogSubscribe(listener: (entries: readonly UciLogEntry[]) => void): () => void {
  listeners.add(listener);
  listener(entries.slice());
  return () => listeners.delete(listener);
}
