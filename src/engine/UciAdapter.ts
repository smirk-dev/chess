/**
 * Low-level ownership of the engine Worker: creates it via an injected factory, ships text lines to
 * it, and fans inbound text lines / errors out to subscribers. Everything UCI-protocol-aware lives
 * one level up in EngineService; this layer is just "a duplex line channel to a worker".
 */
import { uciLogPush } from '../diagnostics/uciLog';
import { ENGINE_DEBUG_LOGGING } from '../config/engineConstants';
import type { EngineWorkerFactory, WorkerLike } from './engineWorkerLoader';

type LineListener = (line: string) => void;
type ErrorListener = (info: { message: string }) => void;

export class UciAdapter {
  private worker: WorkerLike | null = null;
  private readonly lineListeners = new Set<LineListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private disposed = false;

  constructor(private readonly factory: EngineWorkerFactory) {}

  /** Create the worker and wire its event listeners. Resolves once the Worker object exists. */
  async start(): Promise<void> {
    if (this.disposed) throw new Error('UciAdapter: cannot start a disposed adapter');
    if (this.worker) return;
    const worker = await this.factory();
    if (this.disposed) {
      worker.terminate();
      throw new Error('UciAdapter: disposed during start');
    }
    worker.addEventListener('message', (ev: { data: unknown }) => this.handleMessage(ev.data));
    worker.addEventListener('error', (ev: unknown) => this.handleError(ev));
    worker.addEventListener('messageerror', (ev: unknown) => this.handleError(ev));
    this.worker = worker;
    if (ENGINE_DEBUG_LOGGING) uciLogPush('event', 'worker created');
  }

  send(line: string): void {
    if (this.disposed || !this.worker) return;
    uciLogPush('out', line);
    this.worker.postMessage(line);
  }

  onLine(listener: LineListener): () => void {
    this.lineListeners.add(listener);
    return () => this.lineListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  isStarted(): boolean {
    return this.worker !== null && !this.disposed;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
      this.worker = null;
    }
    this.lineListeners.clear();
    this.errorListeners.clear();
    if (ENGINE_DEBUG_LOGGING) uciLogPush('event', 'worker disposed');
  }

  private handleMessage(data: unknown): void {
    // Stockfish's worker posts plain strings (one UCI line each). Be defensive about other shapes.
    let text: string;
    if (typeof data === 'string') text = data;
    else if (data && typeof (data as { data?: unknown }).data === 'string') text = (data as { data: string }).data;
    else return;
    const line = text.replace(/\r$/, '');
    if (line.length === 0) return;
    uciLogPush('in', line);
    for (const l of this.lineListeners) {
      try {
        l(line);
      } catch (err) {
        if (ENGINE_DEBUG_LOGGING) console.error('[uci] line listener threw', err);
      }
    }
  }

  private handleError(ev: unknown): void {
    const message =
      (ev && typeof ev === 'object' && 'message' in ev && typeof (ev as { message: unknown }).message === 'string'
        ? (ev as { message: string }).message
        : undefined) ?? 'engine worker error';
    uciLogPush('event', `worker error: ${message}`);
    for (const l of this.errorListeners) {
      try {
        l({ message });
      } catch {
        /* ignore */
      }
    }
  }
}
