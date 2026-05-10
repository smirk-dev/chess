/**
 * The ONE place that knows where the engine Worker script lives and how to create it. Everything
 * else takes an `EngineWorkerFactory` so tests can inject a `MockEngineWorker` without any DOM/Vite
 * coupling. The engine glue is a *classic* worker script (not an ES module).
 */
import {
  ENGINE_DIR,
  ENGINE_FALLBACK_ENTRY,
  ENGINE_MANIFEST_PATH,
} from '../config/engineConstants';

/** Anything Worker-shaped that the adapter needs. Lets tests pass a fake. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: 'message', listener: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'error' | 'messageerror', listener: (ev: unknown) => void): void;
  removeEventListener(type: string, listener: (ev: never) => void): void;
}

export type EngineWorkerFactory = () => Promise<WorkerLike>;

let cachedEntryUrl: string | null = null;

function baseUrl(): string {
  // `import.meta.env.BASE_URL` is the app's public base path ('/' by default), with a trailing slash.
  return import.meta.env.BASE_URL ?? '/';
}

async function resolveEngineEntryUrl(): Promise<string> {
  if (cachedEntryUrl) return cachedEntryUrl;
  const base = baseUrl();
  try {
    const res = await fetch(base + ENGINE_MANIFEST_PATH, { cache: 'no-cache' });
    if (res.ok) {
      const manifest = (await res.json()) as { engineJs?: string };
      if (manifest.engineJs) {
        cachedEntryUrl = `${base}${ENGINE_DIR}/${manifest.engineJs}`;
        return cachedEntryUrl;
      }
    }
  } catch {
    // Manifest missing/unreadable (e.g. copy-engine didn't run) — fall back to the known filename.
  }
  cachedEntryUrl = base + ENGINE_FALLBACK_ENTRY;
  return cachedEntryUrl;
}

/** Default factory used in the browser. */
export const defaultEngineWorkerFactory: EngineWorkerFactory = async () => {
  const url = await resolveEngineEntryUrl();
  // Classic (non-module) worker — required by the Stockfish emscripten glue.
  return new Worker(url) as unknown as WorkerLike;
};
