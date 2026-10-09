import type { BuildingType } from "../Protocol";

export type BuildingSection = "economy" | "production" | "military" | "defense";
/** Presentation categories are independent of construction and recruitment rules. */
export const BUILDING_SECTION: Record<BuildingType, BuildingSection> = {
  city: "economy",
  factory: "economy",
  port: "economy",
  mine: "economy",
  "oil-well": "economy",
  "oil-rig": "economy",
  blacksmith: "production",
  armory: "production",
  "arms-factory": "production",
  barracks: "military",
  archery: "military",
  stables: "military",
  "siege-workshop": "military",
  depot: "military",
  airstrip: "military",
  "nuclear-facility": "production",
  "drone-facility": "military",
  "missile-silo": "military",
  "mirv-launcher": "military",
  tower: "defense",
  trench: "defense",
  "gun-nest": "defense",
  "missile-defence": "defense",
};
