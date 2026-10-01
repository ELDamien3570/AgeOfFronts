import { AGES, type Age } from "../domain/Definitions";

// Shared opening and growth rules used by simulation and presentation.
export const STARTING_AGE_TROOPS = 6_000;
export const RESERVE_GROWTH = {
  base: [12, 18, 26, 36, 48, 64, 80],
  city: [8, 12, 18, 26, 36, 50, 70],
} as const;
export const baseReserveIncome = (age: Age) =>
  RESERVE_GROWTH.base[AGES.indexOf(age)];
export const cityReserveIncome = (age: Age) =>
  RESERVE_GROWTH.city[AGES.indexOf(age)];
