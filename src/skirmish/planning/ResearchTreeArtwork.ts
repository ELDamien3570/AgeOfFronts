import { russianBuildingUnlocks } from "./RussianExplicitUnlocks";
import type {
  CivilizationPlan,
  PlannedTechnology,
  PlannedUnit,
} from "./TechnologyPlan";
import { troopArtwork } from "./TroopTreeArtwork";
const images = import.meta.glob<string>(
  "../../../Art/Cultures/Russians/Buildings/*/*/Icon.png",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
);
export interface ResearchIcon {
  label: string;
  direct: boolean;
  art: NonNullable<ReturnType<typeof troopArtwork>> | { url: string };
}
/** Resolve once per render from actual subjects and links. No generic fallback. */
export function createResearchArtwork(civ: CivilizationPlan) {
  const byNode = new Map<string, ResearchIcon[]>();
  const units = new Map<string, ResearchIcon[]>();
  const technologies = new Map(civ.technologies.map((t) => [t.id, t]));
  const add = (id: string, icon: ResearchIcon) => {
    const icons = byNode.get(id) ?? [];
    if (
      !icons.some((i) => i.label === icon.label && i.art.url === icon.art.url)
    )
      icons.push(icon);
    byNode.set(id, icons);
  };
  if (civ.id.startsWith("russians")) {
    for (const unit of civ.units.filter(
      (u) => u.availability === "available",
    )) {
      const art = troopArtwork(unit);
      if (!art) continue;
      const icon = { label: unit.name, direct: true, art };
      units.set(unit.id, [icon]);
      for (const unlock of unit.prerequisites) {
        add(unlock, icon);
        for (const parent of technologies.get(unlock)?.prerequisites ?? [])
          add(parent, { ...icon, direct: false });
      }
    }
    for (const node of civ.technologies) {
      for (const folder of node.buildingUnlocks ?? []) {
        const url =
          images[
            `../../../Art/Cultures/Russians/Buildings/${node.age}/${folder}/Icon.png`
          ];
        if (url) add(node.id, { label: folder, direct: true, art: { url } });
      }
    }
    for (const building of russianBuildingUnlocks(civ)) {
      const url =
        images[
          `../../../Art/Cultures/Russians/Buildings/${building.artFolder}/Icon.png`
        ];
      if (!url) continue;
      const icon = { label: building.name, direct: true, art: { url } };
      add(building.id, icon);
      for (const parent of technologies.get(building.id)?.prerequisites ?? [])
        add(parent, { ...icon, direct: false });
    }
  }
  return (node: PlannedTechnology | PlannedUnit): ResearchIcon[] =>
    ("role" in node ? units : byNode).get(node.id) ?? [];
}
