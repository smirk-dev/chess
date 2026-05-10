/**
 * Monotonically increasing tokens used to tag engine move requests. Any `bestmove` (or other async
 * engine reply) carrying a token that isn't the controller's `currentToken` is stale — a New Game,
 * a fresh request, or a difficulty change has happened since — and must be ignored. This is the
 * primary defense against the UCI protocol's inherent asynchrony; the engine layer's cancel-discard
 * is a second, independent layer.
 */
export class RequestTokenSource {
  private value = 0;

  /** Allocate the next token. */
  next(): number {
    this.value += 1;
    return this.value;
  }

  /** Invalidate any outstanding token without allocating one for use yet. */
  bump(): void {
    this.value += 1;
  }

  current(): number {
    return this.value;
  }
}
