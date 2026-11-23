import iris from '../../examples/iris.json';
import coupling from '../../examples/coupling.json';
import truss from '../../examples/truss.json';
import exchanger from '../../examples/exchanger.json';
import harness from '../../examples/harness.json';
import filter from '../../examples/filter.json';
import waveguide from '../../examples/waveguide.json';
import cassette from '../../examples/cassette.json';
import sensor from '../../examples/sensor.json';
import displacement from '../../examples/displacement.json';
import serviceDeck from '../../examples/service-deck.json';
import relayBoard from '../../examples/relay-board.json';
import {
  componentLabels,
  hardwarePatterns,
  isGenerationRecipe,
  parseGenerationRecipe,
  type GenerationRecipe,
} from '../recipes';

export interface LibraryMaterial {
  id: string;
  name: string;
  recipe: GenerationRecipe;
  image?: string;
}

const hardwareRecipes = { iris, coupling, truss, exchanger, harness, filter, waveguide, cassette, sensor };

export const factoryMaterials: LibraryMaterial[] = [
  {
    id: 'service-deck',
    name: 'Service deck',
    recipe: parseGenerationRecipe(JSON.stringify(serviceDeck)),
    image: new URL('../assets/materials/service-deck.webp', import.meta.url).href,
  },
  {
    id: 'relay-board',
    name: 'Relay board',
    recipe: parseGenerationRecipe(JSON.stringify(relayBoard)),
    image: new URL('../assets/materials/relay-board.webp', import.meta.url).href,
  },
  {
    id: 'displacement',
    name: 'Displacement',
    recipe: parseGenerationRecipe(JSON.stringify(displacement)),
    image: new URL('../assets/materials/displacement.webp', import.meta.url).href,
  },
  ...hardwarePatterns.map((pattern) => ({
    id: pattern,
    name: componentLabels[pattern],
    recipe: parseGenerationRecipe(JSON.stringify(hardwareRecipes[pattern])),
    image: new URL(`../assets/materials/${pattern}.webp`, import.meta.url).href,
  })),
];

const prefix = 'greebler.material-library.v1/';

export function readLibrary(): LibraryMaterial[] {
  const items: LibraryMaterial[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix)) continue;
    const value = localStorage.getItem(key);
    if (!value) continue;
    try {
      const item = JSON.parse(value);
      if (item && typeof item.name === 'string' && isGenerationRecipe(item.recipe)) {
        items.push({ id: key.slice(prefix.length), name: item.name, recipe: item.recipe });
      }
    } catch {
      /* Keep other saved materials accessible if one entry is damaged. */
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export function storeLibraryMaterial(entry: LibraryMaterial) {
  // Each variant owns a storage key, so edits from two tabs cannot replace the whole library.
  localStorage.setItem(prefix + entry.id, JSON.stringify({ name: entry.name, recipe: entry.recipe }));
}

export function removeLibraryMaterial(id: string) {
  localStorage.removeItem(prefix + id);
}

export function isLibraryStorageKey(key: string | null) {
  return key === null || key.startsWith(prefix);
}
