import type GUI from "lil-gui";
import type { Controller } from "lil-gui";
import type { ConfigProp } from "../ConfigProp";

/** Colour picker bound to a "#rrggbb" string setting. */
export function hexColor<T extends Record<string, unknown>>(
  target: T,
  key: keyof T & string,
  defaults: T,
  label?: string,
): ConfigProp {
  const defaultVal = defaults[key] as string;
  let ctrl: Controller | undefined;
  return {
    draw(folder: GUI) {
      ctrl = folder.addColor(target, key);
      if (label) ctrl.name(label);
      return ctrl;
    },
    isModified: () =>
      String(target[key]).toLowerCase() !== defaultVal.toLowerCase(),
    resetToDefault() {
      (target as Record<string, unknown>)[key] = defaultVal;
      ctrl?.updateDisplay();
    },
    updateDisplay() {
      ctrl?.updateDisplay();
    },
  };
}
