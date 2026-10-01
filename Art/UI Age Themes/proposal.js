import { BuildingMarkers } from './shared-building-markers.js';

const catalog = await fetch('./themes.json').then(response => response.json());
const themes = catalog.themes;
const portraits = await fetch('./portrait-paths.json').then(response => response.json());
const hud = document.querySelector('#hud');
const select = document.querySelector('#age-select');
const ageUp = document.querySelector('#age-up');
const markers = new BuildingMarkers();
let ageIndex = 0;
let selectedType = 'barracks';
let noticeTimer;
let changeTimer;
const buildingNames = { barracks: 'Barracks', archery: 'Archery', stables: 'Stables', city: 'City', port: 'Port', mine: 'Mine', tower: 'Tower' };
const choices = ['barracks', 'archery', 'stables', 'city', 'port', 'mine', 'tower'];

function applyTheme(element, theme) {
  element.dataset.age = theme.age;
  for (const [key, value] of Object.entries(theme.palette)) element.style.setProperty('--' + key, value);
  element.style.setProperty('--texture', `url('./materials/${theme.file}.webp')`);
}
function symbol(type, color = '#7dccb4', size = 40) {
  const canvas = document.createElement('canvas');
  const ratio = Math.max(1, Math.min(4, window.devicePixelRatio || 1));
  canvas.width = Math.ceil(size * ratio);
  canvas.height = Math.ceil(size * ratio);
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', buildingNames[type] + ' symbol');
  const tile = markers.get(type, color, size, ratio);
  if (tile) canvas.getContext('2d').drawImage(tile.source, tile.x, tile.y, tile.width, tile.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
function rimmedSymbol(type, color, theme) {
  const element = document.createElement('span');
  element.className = 'sample-marker';
  applyTheme(element, theme);
  element.append(symbol(type, color, 18));
  const rim = document.createElement('span');
  rim.className = 'map-rim';
  element.append(rim);
  return element;
}
function renderOwnerExamples() {
  const container = document.querySelector('#marker-examples');
  container.replaceChildren();
  const examples = [
    { owner: 'Yours', theme: themes[ageIndex], color: '#7dccb4' },
    { owner: 'Rival A', theme: themes[1], color: '#da8981' },
    { owner: 'Rival B', theme: themes[6], color: '#dfc784' },
  ];
  for (const example of examples) {
    const row = document.createElement('div');
    row.className = 'marker-example';
    row.dataset.owner = example.owner;
    row.append(rimmedSymbol('city', example.color, example.theme));
    const label = document.createElement('span');
    const owner = document.createElement('b');
    owner.textContent = example.owner;
    const age = document.createElement('small');
    age.textContent = example.theme.name;
    label.append(owner, age);
    row.append(label);
    container.append(row);
  }
  for (const element of document.querySelectorAll('.world-marker[data-owner=local]')) applyTheme(element, themes[ageIndex]);
}
function selectBuilding(type) {
  selectedType = type;
  document.querySelector('#selection-name').textContent = buildingNames[type];
  const image = document.querySelector('#selected-portrait');
  image.src = portraits[themes[ageIndex].age][type];
  image.alt = `${buildingNames[type]} artwork`;
  document.querySelectorAll('.build-choice').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.type === type)));
}
function showAge(index, animate = false) {
  ageIndex = Math.max(0, Math.min(themes.length - 1, index));
  const theme = themes[ageIndex];
  applyTheme(hud, theme);
  select.value = theme.age;
  document.querySelectorAll('.current-age').forEach(label => { label.textContent = theme.name; });
  document.querySelector('#material-name').textContent = theme.material.toUpperCase();
  document.querySelector('#theme-description').textContent = theme.description;
  document.querySelectorAll('.theme-card').forEach((button, i) => button.setAttribute('aria-pressed', String(i === ageIndex)));
  document.querySelectorAll('.age-progress i').forEach((step, i) => step.classList.toggle('reached', i <= ageIndex));
  ageUp.disabled = ageIndex === themes.length - 1;
  ageUp.textContent = ageUp.disabled ? 'Maximum age reached' : 'Simulate age-up →';
  renderOwnerExamples();
  selectBuilding(selectedType);
  hud.classList.remove('age-changing');
  clearTimeout(changeTimer);
  clearTimeout(noticeTimer);
  const notice = document.querySelector('#age-notice');
  notice.classList.remove('visible');
  if (animate) {
    requestAnimationFrame(() => {
      hud.classList.add('age-changing');
      document.querySelector('#notice-age').textContent = theme.name;
      notice.classList.add('visible');
      changeTimer = setTimeout(() => hud.classList.remove('age-changing'), 800);
      noticeTimer = setTimeout(() => notice.classList.remove('visible'), 2200);
    });
  }
}

for (const [index, theme] of themes.entries()) {
  const option = document.createElement('option');
  option.value = theme.age;
  option.textContent = theme.name;
  select.append(option);
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'theme-card age-skin';
  card.setAttribute('aria-label', `${theme.name}: ${theme.material}`);
  card.setAttribute('aria-pressed', 'false');
  applyTheme(card, theme);
  const inner = document.createElement('span');
  inner.className = 'theme-card-inner';
  const canvasSlot = document.createElement('span');
  canvasSlot.className = 'card-symbol';
  const label = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = theme.material;
  const subtitle = document.createElement('small');
  subtitle.textContent = theme.name;
  label.append(title, subtitle);
  inner.append(canvasSlot, label);
  card.append(inner);
  card.addEventListener('click', () => showAge(index));
  document.querySelector('#themes').append(card);
}

select.addEventListener('change', () => showAge(themes.findIndex(theme => theme.age === select.value)));
ageUp.addEventListener('click', () => showAge(ageIndex + 1, true));
document.querySelector('#pause-demo').addEventListener('click', event => {
  const paused = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed', String(paused));
  event.currentTarget.textContent = paused ? '▶ Resume' : 'Ⅱ Pause';
});
document.querySelector('#rally-demo').addEventListener('click', event => {
  const armed = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  event.currentTarget.setAttribute('aria-pressed', String(armed));
  document.querySelector('#selection-note').textContent = armed ? 'Rally mode active · green indicates selection.' : 'Consistent green for health and selection.';
});
const technologyButton = document.querySelector('#technology-demo');
const technologyCard = document.querySelector('#technology-card');
technologyButton.addEventListener('click', () => {
  technologyCard.hidden = !technologyCard.hidden;
  technologyButton.setAttribute('aria-expanded', String(!technologyCard.hidden));
});
document.querySelector('#close-technology').addEventListener('click', () => {
  technologyCard.hidden = true;
  technologyButton.setAttribute('aria-expanded', 'false');
  technologyButton.focus();
});

const loaded = await markers.ready;
if (!loaded) {
  document.querySelector('#load-status').textContent = 'Building symbol atlas failed to load. Serve this preview through the project Vite server.';
} else {
  for (const slot of document.querySelectorAll('.card-symbol')) slot.append(symbol('city', '#7dccb4', 29));
  for (const type of choices) {
    const button = document.createElement('button');
    button.className = 'build-choice';
    button.type = 'button';
    button.dataset.type = type;
    button.setAttribute('aria-label', `Select ${buildingNames[type]}`);
    const frame = document.createElement('span');
    frame.className = 'frame';
    frame.append(symbol(type));
    const label = document.createElement('span');
    label.textContent = buildingNames[type];
    button.append(frame, label);
    button.addEventListener('click', () => selectBuilding(type));
    document.querySelector('#build-buttons').append(button);
  }
  const locations = [
    { type:'barracks', x:38, y:41, owner:'local' },
    { type:'city', x:25, y:54, owner:'local' },
    { type:'archery', x:34, y:68, owner:'local' },
    { type:'mine', x:48, y:20, owner:'local' },
    { type:'tower', x:53, y:60, owner:'local' },
    { type:'port', x:65, y:76, owner:'local' },
    { type:'city', x:57, y:12, owner:'bronze' },
    { type:'tower', x:59, y:36, owner:'bronze' },
    { type:'port', x:69, y:32, owner:'bronze' },
    { type:'tower', x:76, y:86, owner:'modern' },
  ];
  for (const location of locations) {
    const theme = location.owner === 'local' ? themes[0] : themes[location.owner === 'bronze' ? 1 : 6];
    const color = location.owner === 'local' ? '#7dccb4' : location.owner === 'bronze' ? '#da8981' : '#dfc784';
    const element = rimmedSymbol(location.type, color, theme);
    element.classList.add('world-marker');
    element.style.left = location.x + '%';
    element.style.top = location.y + '%';
    element.dataset.owner = location.owner;
    element.title = `${buildingNames[location.type]} · ${location.owner === 'local' ? 'Your faction' : theme.name + ' rival'}`;
    document.querySelector('#world-markers').append(element);
  }
  document.querySelector('#load-status').hidden = true;
}
showAge(0);
