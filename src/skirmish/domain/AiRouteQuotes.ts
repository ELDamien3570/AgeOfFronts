import type { ExactRouteOutcome } from "../RoutePlanner";
import type { DomainRouteConsumer, DomainRouteTask } from "./DomainRoutePorts";
import type { Expansion } from "./Expansion";

interface Quote {
  id: number;
  key: string;
  playerId: number;
  generation: number;
  start: number;
  goal: number;
  water: boolean;
  revision: string;
  expires: number;
  task: DomainRouteTask;
  requested: boolean;
  attempts: number;
  retryAt: number;
  outcome?: ExactRouteOutcome;
  path: number[];
}
/** Exact route certificates for bounded strategic searches. They grant no movement
 * authority: the normal command still admits every member and footprint. */
export class AiRouteQuotes implements DomainRouteConsumer {
  private readonly quotes = new Map<string, Quote>();
  private serial = 0;
  constructor(private readonly expansion: Expansion) {}
  checkpoint() {
    return structuredClone({ quotes: [...this.quotes], serial: this.serial });
  }
  restore(saved?: ReturnType<AiRouteQuotes["checkpoint"]>): void {
    this.quotes.clear();
    this.serial = saved?.serial ?? 0;
    for (const [key, quote] of structuredClone(saved?.quotes ?? []))
      this.quotes.set(key, quote);
  }
  release(key: string): void {
    const quote = this.quotes.get(key);
    if (quote) this.expansion.world.domainRoutes?.cancel(quote.task);
    this.quotes.delete(key);
  }
  releasePlayer(playerId: number): void {
    for (const [key, quote] of this.quotes)
      if (quote.playerId === playerId) this.release(key);
  }
  request(
    key: string,
    playerId: number,
    start: number,
    goal: number,
    water = false,
  ): { pending: boolean; path?: readonly number[]; reason?: string } {
    const { world } = this.expansion,
      ports = world.domainRoutes;
    if (!ports)
      return { pending: false, reason: "Exact strategic routing unavailable" };
    const generation = world.aiGeneration(playerId),
      revision = water ? "water" : ports.revision();
    let quote = this.quotes.get(key);
    if (
      quote &&
      (quote.start !== start ||
        quote.goal !== goal ||
        quote.water !== water ||
        quote.generation !== generation ||
        quote.revision !== revision ||
        quote.expires <= world.tick)
    ) {
      this.release(key);
      quote = undefined;
    }
    if (!quote) {
      // Fixed storage and finite expiry; no hidden synchronous fallback on pressure.
      for (const [expiredKey, q] of this.quotes)
        if (q.expires <= world.tick) this.release(expiredKey);
      if (this.quotes.size >= 64)
        return { pending: false, reason: "Strategic quote capacity exhausted" };
      const id = ++this.serial;
      quote = {
        id,
        key,
        playerId,
        generation,
        start,
        goal,
        water,
        revision,
        expires: world.tick + 1200,
        requested: false,
        attempts: 0,
        retryAt: world.tick,
        path: [],
        task: {
          kind: "domain",
          owner: "strategy",
          playerId,
          admissionId: id,
          memberId: 0,
          stage: "quote",
          generation,
        },
      };
      this.quotes.set(key, quote);
    }
    if (quote.outcome)
      return quote.outcome === "complete"
        ? { pending: false, path: quote.path }
        : { pending: false, reason: `Exact route ${quote.outcome}` };
    if (!quote.requested && world.tick >= quote.retryAt) {
      quote.requested = ports.request(quote.task, start, goal, water);
      if (!quote.requested) {
        quote.attempts++;
        quote.retryAt = world.tick + 20 * quote.attempts;
        if (quote.attempts >= 4) {
          quote.outcome = "limited";
          return { pending: false, reason: "Exact route admission exhausted" };
        }
      }
    }
    return { pending: true };
  }
  validRoute(task: DomainRouteTask): boolean {
    const quote = [...this.quotes.values()].find(
      (q) => q.id === task.admissionId,
    );
    const { world } = this.expansion;
    return (
      !!quote &&
      quote.requested &&
      quote.generation === world.aiGeneration(quote.playerId) &&
      quote.expires > world.tick &&
      (quote.water || quote.revision === world.domainRoutes?.revision())
    );
  }
  completedRoute(
    task: DomainRouteTask,
    outcome: ExactRouteOutcome,
    path: number[],
  ): void {
    const quote = [...this.quotes.values()].find(
      (q) => q.id === task.admissionId,
    );
    if (!quote || !this.validRoute(task)) return;
    quote.requested = false;
    quote.outcome = outcome;
    quote.path = outcome === "complete" ? [...path] : [];
  }
}
