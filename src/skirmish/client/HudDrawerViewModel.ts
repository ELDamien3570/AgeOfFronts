// Local presentation preference; never changes match commands or hotkey rules.
export class HudDrawerViewModel {
  dynamic = false;
  private placing = false;

  get expanded(): boolean {
    return !this.dynamic || this.placing;
  }

  toggleMode(): void {
    this.dynamic = !this.dynamic;
  }

  setPlacement(active: boolean): void {
    this.placing = active;
  }
}
