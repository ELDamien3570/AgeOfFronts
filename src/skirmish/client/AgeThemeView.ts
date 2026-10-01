import { AGE_NAMES, AGES, type Age } from "../domain/Definitions";
import { AGE_UI_THEMES } from "./AgeUiTheme";

// Presentation cache only: the view model's earned age remains authoritative.
export class AgeThemeView {
  private previousAge?: Age;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly notice: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.notice = root.ownerDocument.createElement("div");
    this.notice.className = "ui-age-notice";
    this.notice.setAttribute("role", "status");
    this.notice.setAttribute("aria-live", "polite");
    this.notice.hidden = true;
    root.append(this.notice);
    this.apply("StoneAge");
  }

  update(age: Age): void {
    if (age === this.previousAge) return;
    const advanced =
      this.previousAge !== undefined &&
      AGES.indexOf(age) > AGES.indexOf(this.previousAge);
    this.cancelTransition();
    this.apply(age);
    this.previousAge = age;
    if (!advanced) return;
    this.notice.textContent = `Age reached · ${AGE_NAMES[AGES.indexOf(age)]}`;
    this.notice.hidden = false;
    if (
      !this.root.ownerDocument.defaultView?.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches
    )
      this.root.classList.add("ui-age-arrival");
    this.timer = setTimeout(() => this.cancelTransition(), 2200);
  }

  reset(): void {
    this.cancelTransition();
    this.previousAge = undefined;
    this.apply("StoneAge");
  }

  private apply(age: Age): void {
    const theme = AGE_UI_THEMES[age];
    this.root.dataset.uiAge = age;
    for (const [name, value] of Object.entries(theme.palette))
      this.root.style.setProperty(`--age-${name}`, value);
    this.root.style.setProperty("--age-texture", `url("${theme.texture}")`);
  }

  private cancelTransition(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.root.classList.remove("ui-age-arrival");
    this.notice.hidden = true;
  }
}
