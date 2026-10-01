const urls = [
  new URL(
    "../../../Art/Formation Icons/Rank Insignias/png/level-01.png",
    import.meta.url,
  ).href,
  new URL(
    "../../../Art/Formation Icons/Rank Insignias/png/level-02.png",
    import.meta.url,
  ).href,
  new URL(
    "../../../Art/Formation Icons/Rank Insignias/png/level-03.png",
    import.meta.url,
  ).href,
  new URL(
    "../../../Art/Formation Icons/Rank Insignias/png/level-04.png",
    import.meta.url,
  ).href,
  new URL(
    "../../../Art/Formation Icons/Rank Insignias/png/level-05.png",
    import.meta.url,
  ).href,
  new URL(
    "../../../Art/Formation Icons/Rank Insignias/png/level-06.png",
    import.meta.url,
  ).href,
  new URL(
    "../../../Art/Formation Icons/Rank Insignias/png/level-07.png",
    import.meta.url,
  ).href,
];
export const promotionUrl = (level: number): string =>
  urls[Math.max(0, Math.min(6, level - 1))];
export class PromotionArtwork {
  private readonly images = new Map<number, HTMLImageElement>();
  private readonly requested = new Set<number>();
  get(level: number): HTMLImageElement | undefined {
    if (!this.requested.has(level)) {
      this.requested.add(level);
      const image = new Image();
      image.decoding = "async";
      image.onload = () => this.images.set(level, image);
      image.src = promotionUrl(level);
    }
    return this.images.get(level);
  }
}
