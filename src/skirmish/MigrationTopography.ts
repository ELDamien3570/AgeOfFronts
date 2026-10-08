import { MIGRATION_THEME } from "./content/Migration";
import { createRegionalTopography } from "./RegionalTopography";
export function migrationTopography(size: number, seed: number) {
  return createRegionalTopography(size, seed, MIGRATION_THEME.topography);
}
export function migrationHeightSource(size: number, seed: number) {
  return migrationTopography(size, seed).heightAt;
}
