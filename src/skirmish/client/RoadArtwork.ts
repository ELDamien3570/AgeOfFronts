import { AGES } from "../domain/Definitions";
const urls = import.meta.glob<string>(
  "../../../Art/Terrain/Trade Roads/*/Road_Atlas_Padded.png",
  { eager: true, query: "?url", import: "default" },
);
export class RoadArtwork {
  private images = new Map<number, HTMLImageElement>();
  frame(age: number): HTMLImageElement | undefined {
    const image = this.images.get(age);
    if (image) return image.complete && image.naturalWidth ? image : undefined;
    const url =
      urls[
        `../../../Art/Terrain/Trade Roads/${AGES[age]}/Road_Atlas_Padded.png`
      ];
    if (!url) return;
    const next = new Image();
    next.src = url;
    this.images.set(age, next);
    return undefined;
  }
}
