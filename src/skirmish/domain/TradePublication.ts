import type { TradeActor } from "./Definitions";

// Publication revisions belong to the domain owner, not canonical saves/wire
// records. Unmanaged DTOs retain the encoder's deep-comparison fallback.
const revisions = new WeakMap<TradeActor, number>();
export function ownTradePublication(actor: TradeActor): void { revisions.set(actor, 0); }
export function tradeDetailRevision(actor: TradeActor): number | undefined { return revisions.get(actor); }
export function tradeDetailsChanged(actor: TradeActor): void {
  const revision = revisions.get(actor);
  if (revision !== undefined) revisions.set(actor, revision + 1);
}
