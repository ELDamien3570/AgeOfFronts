/** Wall time keeps retries independent of paused or accelerated matches. */
export const ARTWORK_MAX_ATTEMPTS = 3;
export const artworkRetryDelay = (attempt: number): number => 1000 * 4 ** (attempt - 1);

export interface ArtworkFailure {
  attempts: number;
  retryAt: number;
}

export function artworkCanRetry(failure: ArtworkFailure | undefined): boolean {
  return !failure || (failure.attempts < ARTWORK_MAX_ATTEMPTS && Date.now() >= failure.retryAt);
}

export function artworkFailure(previous: ArtworkFailure | undefined): ArtworkFailure {
  const attempts = (previous?.attempts ?? 0) + 1;
  return { attempts, retryAt: Date.now() + artworkRetryDelay(attempts) };
}
