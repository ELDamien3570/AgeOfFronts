// Generated preview dependency; production source remains authoritative.
const manifest = { "themes": [{ "age": "StoneAge", "name": "Stone Age", "material": "Stone", "file": "stone", "description": "Rugged fractured fieldstone, chipped corners and deep charcoal recesses.", "palette": { "rim": "#8d8b7d", "light": "#cac8b9", "edge": "#41443f", "panel": "#222721", "ink": "#eee9dc", "muted": "#b7b4a5" } }, { "age": "BronzeAge", "name": "Bronze Age", "material": "Bronze", "file": "bronze", "description": "Warm bronze trim, restrained patina, round forged corner studs.", "palette": { "rim": "#a3703d", "light": "#e1ae65", "edge": "#493526", "panel": "#29231d", "ink": "#f0e5d2", "muted": "#c5b59a" } }, { "age": "ClassicalAge", "name": "Classical Age", "material": "Iron", "file": "iron", "description": "Dark forged-iron straps with hammered edges and simple rivets.", "palette": { "rim": "#626566", "light": "#aaa99f", "edge": "#303537", "panel": "#212425", "ink": "#e6e7df", "muted": "#b2b5ae" } }, { "age": "EarlyMedieval", "name": "Early Medieval", "material": "Shimmering steel", "file": "steel", "description": "Pale polished steel bevels, with one brief glint on age-up.", "palette": { "rim": "#acb8bf", "light": "#e6eff1", "edge": "#465761", "panel": "#222931", "ink": "#e9eef1", "muted": "#b5c1c8" } }, { "age": "LateMedieval", "name": "Late Medieval", "material": "Gold", "file": "gold", "description": "Gilded trim and corner fittings around a quiet dark inlay.", "palette": { "rim": "#ba8b35", "light": "#f4d585", "edge": "#64471f", "panel": "#2b251b", "ink": "#f1e8d5", "muted": "#cbbb98" } }, { "age": "EarlyModern", "name": "Early Modern", "material": "Gunmetal", "file": "gunmetal", "description": "Blued metal frames, precise brackets and recessed fasteners.", "palette": { "rim": "#58656b", "light": "#a4b0b4", "edge": "#273239", "panel": "#1b242a", "ink": "#e1e8e9", "muted": "#aebdc1" } }, { "age": "Modern", "name": "Modern", "material": "Army green", "file": "army-green", "description": "Matte olive frames, square field fittings and restrained stencils.", "palette": { "rim": "#65704a", "light": "#a3af77", "edge": "#323b29", "panel": "#222a20", "ink": "#e8e9dc", "muted": "#b6bea4" } }] };
const AGES = ["StoneAge", "BronzeAge", "ClassicalAge", "EarlyMedieval", "LateMedieval", "EarlyModern", "Modern"];
// Explicit URLs let the build package the seven shared material surfaces.
const textures = {
    StoneAge: new URL("./materials/stone.webp", import.meta.url).href,
    BronzeAge: new URL("./materials/bronze.webp", import.meta.url).href,
    ClassicalAge: new URL("./materials/iron.webp", import.meta.url).href,
    EarlyMedieval: new URL("./materials/steel.webp", import.meta.url).href,
    LateMedieval: new URL("./materials/gold.webp", import.meta.url).href,
    EarlyModern: new URL("./materials/gunmetal.webp", import.meta.url).href,
    Modern: new URL("./materials/army-green.webp", import.meta.url).href,
};
export const AGE_UI_THEMES = Object.freeze(Object.fromEntries(AGES.map((age) => {
    const source = manifest.themes.find((theme) => theme.age === age);
    if (!source)
        throw new Error(`Missing UI theme: ${age}`);
    return [
        age,
        Object.freeze({
            age,
            material: source.material,
            texture: textures[age],
            palette: Object.freeze({ ...source.palette }),
        }),
    ];
})));
// Owner progression is independent of a building's construction age and HUD age.
export function ownerUiAge(snapshot, playerId) {
    return snapshot.expansion?.progression[playerId]?.age;
}
export function drawAgeMarkerRim(ctx, x, y, pixels, age) {
    const { light, edge } = AGE_UI_THEMES[age].palette;
    const rim = pixels / 12;
    ctx.strokeStyle = light;
    ctx.lineWidth = rim;
    ctx.strokeRect(x + rim / 2, y + rim / 2, pixels - rim, pixels - rim);
    ctx.strokeStyle = edge;
    ctx.lineWidth = pixels / 36;
    ctx.strokeRect(x + rim, y + rim, pixels - rim * 2, pixels - rim * 2);
}
