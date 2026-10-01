import manifest from "../../../Art/UI Age Themes/themes.json";
import { AGES, type Age } from "../domain/Definitions";
import type { Snapshot } from "../Protocol";

export interface AgeUiTheme {
  readonly age: Age;
  readonly material: string;
  readonly texture: string;
  readonly palette: Readonly<{
    rim: string;
    light: string;
    edge: string;
    panel: string;
    ink: string;
    muted: string;
  }>;
}

// Explicit URLs let the build package the seven shared material surfaces.
const textures: Record<Age, string> = {
  StoneAge: new URL(
    "../../../Art/UI Age Themes/materials/stone.webp",
    import.meta.url,
  ).href,
  BronzeAge: new URL(
    "../../../Art/UI Age Themes/materials/bronze.webp",
    import.meta.url,
  ).href,
  ClassicalAge: new URL(
    "../../../Art/UI Age Themes/materials/iron.webp",
    import.meta.url,
  ).href,
  EarlyMedieval: new URL(
    "../../../Art/UI Age Themes/materials/steel.webp",
    import.meta.url,
  ).href,
  LateMedieval: new URL(
    "../../../Art/UI Age Themes/materials/gold.webp",
    import.meta.url,
  ).href,
  EarlyModern: new URL(
    "../../../Art/UI Age Themes/materials/gunmetal.webp",
    import.meta.url,
  ).href,
  Modern: new URL(
    "../../../Art/UI Age Themes/materials/army-green.webp",
    import.meta.url,
  ).href,
};

export const AGE_UI_THEMES = Object.freeze(
  Object.fromEntries(
    AGES.map((age) => {
      const source = manifest.themes.find((theme) => theme.age === age);
      if (!source) throw new Error(`Missing UI theme: ${age}`);
      return [
        age,
        Object.freeze({
          age,
          material: source.material,
          texture: textures[age],
          palette: Object.freeze({ ...source.palette }),
        }),
      ];
    }),
  ) as Record<Age, AgeUiTheme>,
);

// Owner progression is independent of a building's construction age and HUD age.
export function ownerUiAge(
  snapshot: Pick<Snapshot, "expansion">,
  playerId: number,
): Age | undefined {
  return snapshot.expansion?.progression[playerId]?.age;
}

export function drawAgeMarkerRim(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  pixels: number,
  age: Age,
): void {
  const { light, edge } = AGE_UI_THEMES[age].palette;
  const rim = pixels / 12;
  ctx.strokeStyle = light;
  ctx.lineWidth = rim;
  ctx.strokeRect(x + rim / 2, y + rim / 2, pixels - rim, pixels - rim);
  ctx.strokeStyle = edge;
  ctx.lineWidth = pixels / 36;
  ctx.strokeRect(x + rim, y + rim, pixels - rim * 2, pixels - rim * 2);
}
