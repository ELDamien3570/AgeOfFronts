import Countries from "../../../../resources/countries.json";

/** Same free/local catalog policy as OpenFront's InventoryModal. */
export const EMPIRE_FLAGS = Countries.filter(
  (country) => country.code !== "xx" && country.restricted !== true,
).map((country) => ({
  code: country.code,
  name: country.name,
  image: `/flags/${encodeURIComponent(country.code)}.svg`,
}));

export function empireFlag(code: string | null) {
  return EMPIRE_FLAGS.find((flag) => flag.code === code);
}
