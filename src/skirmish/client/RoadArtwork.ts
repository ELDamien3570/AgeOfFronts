import { AGES } from "../domain/Definitions";
const urls = import.meta.glob<string>(
  "../../../Art/Terrain/Trade Roads/*/Road_Atlas_Padded.png",
  { eager: true, query: "?url", import: "default" },
);
export class RoadArtwork {
  private images = new Map<number, HTMLImageElement>();
  constructor(private readonly ready: () => void = () => {}) {}
  frame(age: number): HTMLImageElement | undefined {
    const image = this.images.get(age);
    if (image) return image.complete && image.naturalWidth ? image : undefined;
    const url =
      urls[
        `../../../Art/Terrain/Trade Roads/${AGES[age]}/Road_Atlas_Padded.png`
      ];
    if (!url) return;
    const next = new Image();
    next.onload = this.ready;
    this.images.set(age, next);
    next.src = url;
    return next.complete && next.naturalWidth ? next : undefined;
  }
}
