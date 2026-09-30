// Review-only MVVM: the catalog and display choices live in this view model;
// the view draws original atlas rectangles without editing the source images.
class TerrainLibraryViewModel {
  constructor(manifest) {
    this.manifest = manifest;
    this.family = "all";
    this.background = "ground";
    this.cellSize = 14;
  }
  get families() {
    return this.manifest.atlases.filter(
      (atlas) => this.family === "all" || atlas.id === this.family,
    );
  }
}

const library = document.querySelector("#library");
const family = document.querySelector("#family");
const background = document.querySelector("#background");
const cellSize = document.querySelector("#cell-size");
const output = document.querySelector("#cell-output");
const images = new Map();

function paintBackground(ctx, width, height, mode, ground, grid) {
  ctx.fillStyle =
    mode === "dark" ? "#20303a" : mode === "light" ? "#d2c9aa" : ground;
  ctx.fillRect(0, 0, width, height);
  if (mode === "checker") {
    for (let y = 0; y < height; y += 12)
      for (let x = 0; x < width; x += 12) {
        ctx.fillStyle = ((x + y) / 12) % 2 === 0 ? "#465458" : "#677478";
        ctx.fillRect(x, y, 12, 12);
      }
  } else if (grid) {
    ctx.strokeStyle = "#12292235";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += grid) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += grid) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }
}

function drawSprite(canvas, atlas, slot, image, viewModel, inspect) {
  const width = 280,
    height = 200;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  paintBackground(
    ctx,
    width,
    height,
    viewModel.background,
    atlas.groundPreview,
    inspect ? 0 : viewModel.cellSize,
  );
  const [sx, sy, sw, sh] = slot.sourceRect;
  const [bx, by, bw, bh] = slot.alphaBounds;
  // Bounds determine scale and centering; all source pixels are drawn intact.
  const scale = inspect
    ? Math.min(160 / bw, 160 / bh)
    : (slot.visibleFootprintCells * viewModel.cellSize) / Math.max(bw, bh);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    sx,
    sy,
    sw,
    sh,
    width / 2 - (bx + bw / 2) * scale,
    height / 2 - (by + bh / 2) * scale,
    sw * scale,
    sh * scale,
  );
}

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function render(viewModel) {
  library.replaceChildren();
  const count = viewModel.manifest.atlases.reduce(
    (sum, atlas) => sum + atlas.slots.length,
    0,
  );
  document.querySelector("#summary").textContent =
    `${viewModel.manifest.atlases.length} environment families. ${count} starter sprites. Painted accents at a small, consistent world footprint.`;
  const overview = document.querySelector("#overview");
  overview.replaceChildren();
  for (const atlas of viewModel.manifest.atlases) {
    const button = document.createElement("button");
    button.className = "family-button";
    button.setAttribute("aria-label", `Inspect ${atlas.name}`);
    button.setAttribute("aria-pressed", String(viewModel.family === atlas.id));
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 120;
    const ctx = canvas.getContext("2d");
    paintBackground(
      ctx,
      160,
      120,
      viewModel.background,
      atlas.groundPreview,
      0,
    );
    ctx.drawImage(images.get(atlas.id), 20, 0, 120, 120);
    button.append(canvas, textElement("span", atlas.name));
    button.addEventListener("click", () => {
      viewModel.family = atlas.id;
      family.value = atlas.id;
      render(viewModel);
      library.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    overview.append(button);
  }
  output.value = `${viewModel.cellSize} px`;
  for (const atlas of viewModel.families) {
    const section = document.createElement("section");
    section.append(textElement("h2", atlas.name));
    const meta = document.createElement("div");
    meta.className = "family-meta";
    meta.append(
      textElement(
        "span",
        `${atlas.pixelSize.join(" × ")} px original · four slots`,
      ),
    );
    const link = textElement("a", "Open original transparent atlas");
    link.href = atlas.file;
    link.target = "_blank";
    link.rel = "noopener";
    meta.append(link);
    section.append(meta);
    const grid = document.createElement("div");
    grid.className = "sprites";
    for (const slot of atlas.slots) {
      const card = document.createElement("article");
      card.className = "sprite";
      const header = document.createElement("header");
      header.append(textElement("h3", slot.name));
      header.append(
        textElement("p", `${slot.role} · ${slot.visibleFootprintCells} cells`),
      );
      card.append(header);
      for (const inspect of [true, false]) {
        const canvas = document.createElement("canvas");
        if (!inspect) canvas.className = "scale-view";
        canvas.setAttribute(
          "aria-label",
          `${atlas.name}: ${slot.name}, ${inspect ? "large inspection" : "terrain-cell scale"}`,
        );
        drawSprite(
          canvas,
          atlas,
          slot,
          images.get(atlas.id),
          viewModel,
          inspect,
        );
        card.append(
          canvas,
          textElement(
            "div",
            inspect
              ? "Large inspection"
              : `${viewModel.cellSize} px per terrain cell · intended footprint`,
            "view-caption",
          ),
        );
      }
      card.append(textElement("p", slot.description, "description"));
      grid.append(card);
    }
    section.append(grid);
    library.append(section);
  }
}

try {
  const response = await fetch("./manifest.json");
  if (!response.ok) throw new Error("Asset manifest could not be loaded");
  const viewModel = new TerrainLibraryViewModel(await response.json());
  for (const atlas of viewModel.manifest.atlases) {
    const option = document.createElement("option");
    option.value = atlas.id;
    option.textContent = atlas.name;
    family.append(option);
  }
  await Promise.all(
    viewModel.manifest.atlases.map(async (atlas) => {
      const image = new Image();
      image.src = atlas.file;
      await image.decode();
      images.set(atlas.id, image);
    }),
  );
  family.addEventListener("change", () => {
    viewModel.family = family.value;
    render(viewModel);
  });
  background.addEventListener("change", () => {
    viewModel.background = background.value;
    render(viewModel);
  });
  cellSize.addEventListener("input", () => {
    viewModel.cellSize = Number(cellSize.value);
    render(viewModel);
  });
  render(viewModel);
} catch (error) {
  library.replaceChildren(
    textElement("p", `Preview could not load: ${error.message}`, "error"),
  );
}
