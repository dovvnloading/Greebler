import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  ArrowDownToLine,
  Boxes,
  FileBox,
  FolderOpen,
  Hammer,
  Keyboard,
  PanelLeft,
  PanelRight,
  Paintbrush,
  Redo2,
  Save,
  Undo2,
  X,
} from 'lucide-react';
import {
  createGenerationRecipe,
  getGenerationRecipeId,
  styleNames,
  parseGenerationRecipe,
  serializeGenerationRecipe,
  type GenerationRecipe,
} from './recipes';
import { PALETTE_PRESETS } from './utils/colorUtils';
import { recipeHistory, type RecipeSource } from './engine/recipeHistory';
import { useMaterialSession } from './engine/useMaterialSession';
import { describeExport } from './export/materialMaps';
import { RecipeInspector } from './components/RecipeInspector';
import { MaterialWorkspace } from './components/MaterialWorkspace';
import { MaterialExports } from './components/MaterialExports';
import { MaterialLibrary, SaveMaterial } from './workspace/MaterialLibrary';
import { Dialog } from './workspace/Dialog';
import { DockResize } from './workspace/DockResize';
import { useWorkspaceLayout } from './workspace/useWorkspaceLayout';
import {
  storeLibraryMaterial,
  removeLibraryMaterial,
  factoryMaterials,
  readLibrary,
  isLibraryStorageKey,
  type LibraryMaterial,
} from './workspace/materialLibrary';
import type { AssetHistory } from './modeling/history';
import './modeling/ModelWorkspace.css';

const ModelWorkspace = lazy(() =>
  import('./modeling/ModelWorkspace').then((module) => ({ default: module.ModelWorkspace })),
);

const recipeKey = 'greebler.editor.recipe';
const documentKey = 'greebler.editor.source.v1';
const sizes = [512, 1024, 2048, 4096, 8192];
type Modal = 'export' | 'save' | 'shortcuts' | null;
function loadRecipe() {
  try {
    const text = localStorage.getItem(recipeKey);
    if (text) return parseGenerationRecipe(text);
  } catch {
    /* Use the initial material if storage is unavailable. */
  }
  return createGenerationRecipe({
    reliefProfile: 'formed',
    style: 'tech',
    panelPattern: 'mixed',
    resolution: 1024,
    seed: 12345,
    largeDensity: 0.8,
    mediumDensity: 0.6,
    smallDensity: 0.4,
    gapSize: 4,
    complexity: 5,
    palette: PALETTE_PRESETS.Default,
  });
}
function readSource(): RecipeSource | null {
  try {
    const s = JSON.parse(localStorage.getItem(documentKey) ?? 'null');
    if (s && typeof s.name === 'string' && typeof s.recipeId === 'string')
      return { name: s.name, recipeId: s.recipeId, assetId: typeof s.assetId === 'string' ? s.assetId : undefined };
  } catch {
    /* Descriptive metadata is optional. */
  }
  return null;
}
function initialLibrary() {
  try {
    return readLibrary();
  } catch {
    return [];
  }
}

export default function App() {
  const [workspace, setWorkspace] = useState<'surface' | 'model'>('surface');
  const modelSession = useRef<AssetHistory | null>(null);
  const rememberModel = useCallback((next: AssetHistory) => {
    modelSession.current = next;
  }, []);
  const [history, dispatch] = useReducer(recipeHistory, undefined, () => {
    const current = loadRecipe();
    const factory = factoryMaterials.find(
      (item) => serializeGenerationRecipe(item.recipe) === serializeGenerationRecipe(current),
    );
    const source = readSource() ?? {
      name: factory?.name ?? `${styleNames[current.params.style]} material`,
      recipeId: getGenerationRecipeId(current),
      assetId: factory?.id,
    };
    return { current, source, past: [], future: [], time: 0 };
  });
  const { current: recipe, source } = history;
  const { material, render, progress, cancel, error } = useMaterialSession();
  const layout = useWorkspaceLayout();
  const [saved, setSaved] = useState(initialLibrary);
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState('');
  const [importError, setImportError] = useState('');
  const importRequest = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = getGenerationRecipeId(recipe);
  const documentName = source?.name ?? `${styleNames[recipe.params.style]} material`;
  const modified = Boolean(source && source.recipeId !== id);
  useEffect(() => {
    document.title = `${documentName}${modified ? ' *' : ''} · Greebler`;
  }, [documentName, modified]);
  const resolution = recipe.params.resolution;
  const output = material ? describeExport(material.recipe, recipe) : '';
  const addRecipe = useCallback(
    (next: GenerationRecipe, group?: string) =>
      dispatch({ type: 'edit', recipe: next, group, time: performance.now() }),
    [],
  );

  useEffect(() => {
    render(recipe, 'draft');
    try {
      localStorage.setItem(recipeKey, serializeGenerationRecipe(recipe));
    } catch {
      /* Browser storage is optional. */
    }
  }, [recipe, render]);
  useEffect(() => {
    try {
      if (source) localStorage.setItem(documentKey, JSON.stringify(source));
      else localStorage.removeItem(documentKey);
    } catch {
      /* Optional metadata. */
    }
  }, [source]);
  useEffect(() => {
    const refresh = (e: StorageEvent) => {
      if (isLibraryStorageKey(e.key)) setSaved(initialLibrary());
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 6500);
    return () => clearTimeout(timer);
  }, [notice]);

  function openAsset(item: LibraryMaterial) {
    importRequest.current++;
    setImportError('');
    dispatch({
      type: 'edit',
      recipe: item.recipe,
      source: { name: item.name, recipeId: getGenerationRecipeId(item.recipe), assetId: item.id },
      time: performance.now(),
    });
    layout.closeDrawer();
  }
  function saveLocal(name: string) {
    try {
      const assetId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
        n.toString(16).padStart(2, '0'),
      ).join('');
      const entry = { id: assetId, name, recipe };
      if (readLibrary().some((item) => item.name.toLowerCase() === name.toLowerCase()))
        return 'A saved material already has this name.';
      storeLibraryMaterial(entry);
      setSaved(readLibrary());
      dispatch({ type: 'name', source: { name, recipeId: id, assetId: entry.id } });
      setNotice('Material saved to library');
      return null;
    } catch {
      return 'Could not save this material in browser storage. Use Save recipe to keep a file.';
    }
  }
  function removeLocal(assetId: string) {
    try {
      removeLibraryMaterial(assetId);
      setSaved(readLibrary());
      setNotice('Material removed from library');
      return true;
    } catch {
      return false;
    }
  }
  async function importRecipe(file?: File) {
    if (!file) return;
    const request = ++importRequest.current;
    setImportError('');
    try {
      if (file.size > 65536) throw new Error('A material recipe must be smaller than 64 KiB.');
      const next = parseGenerationRecipe(await file.text());
      if (request !== importRequest.current) return;
      dispatch({
        type: 'edit',
        recipe: next,
        time: performance.now(),
        source: {
          name: file.name.replace(/\.json$/i, '') || 'Imported material',
          recipeId: getGenerationRecipeId(next),
        },
      });
      layout.closeDrawer();
      setNotice('Recipe opened');
    } catch (cause) {
      if (request === importRequest.current)
        setImportError(
          cause instanceof SyntaxError
            ? 'Invalid material recipe. Choose a valid JSON file.'
            : cause instanceof Error
              ? cause.message
              : 'Could not read that recipe.',
        );
    }
  }
  function saveRecipe() {
    const url = URL.createObjectURL(new Blob([serializeGenerationRecipe(recipe)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  useLayoutEffect(() => {
    function keydown(e: KeyboardEvent) {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.altKey ||
        (document.querySelector('dialog[open]') && !target?.closest('.dialog-right .recipe-inspector'))
      )
        return;
      const inspectorField = target?.closest('.recipe-inspector input[type=number], .recipe-inspector #palette-hex');
      const textInput = inspectorField
        ? inspectorField.hasAttribute('data-editing-draft')
        : target?.closest(
            'textarea, [contenteditable=true], input:not([type]), input:is([type=text],[type=search],[type=number],[type=email],[type=url],[type=tel],[type=password])',
          );
      const key = e.key.toLowerCase();
      // The model workspace owns its source document and history shortcuts.
      if (workspace === 'model' && (e.metaKey || e.ctrlKey) && ['s', 'o', 'z', 'y', 'k'].includes(key)) return;
      if (e.metaKey || e.ctrlKey) {
        if (key === 's' && !e.shiftKey) {
          e.preventDefault();
          saveRecipe();
        } else if (key === 'o' && !e.shiftKey) {
          e.preventDefault();
          fileInput.current?.click();
        } else if (key === 'k' && !e.shiftKey) {
          e.preventDefault();
          layout.findMaterials();
        } else if (key === 'enter') {
          e.preventDefault();
          render(recipe, 'bake');
        } else if (!textInput && (key === 'z' || key === 'y')) {
          e.preventDefault();
          dispatch({ type: key === 'y' || e.shiftKey ? 'redo' : 'undo' });
        }
      } else if (e.shiftKey && e.code === 'Space' && !textInput && !e.repeat) {
        e.preventDefault();
        layout.toggleFocus();
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  const library = (
    <MaterialLibrary
      saved={saved}
      activeId={source?.assetId}
      onSelect={openAsset}
      onSave={() => setModal('save')}
      onRemove={removeLocal}
      onImport={() => fileInput.current?.click()}
      onDownload={saveRecipe}
      importError={layout.drawer === 'library' ? importError : undefined}
      searchRequest={layout.searchRequest}
    />
  );
  const statusError = error || importError;
  const properties = <RecipeInspector recipe={recipe} material={material} onChange={addRecipe} />;

  return (
    <div className={layout.focused ? 'editor-app is-focused' : 'editor-app'}>
      <header className="app-bar">
        <div className="app-brand">
          <img
            className="brand-mark"
            src={new URL('./assets/greebler-mark.png', import.meta.url).href}
            alt=""
            width={28}
            height={28}
          />
          <h1>Greebler</h1>
        </div>
        <nav className="studio-workspaces" aria-label="Studio workspace">
          <button
            type="button"
            aria-label="Surface workspace"
            aria-pressed={workspace === 'surface'}
            onClick={() => {
              setWorkspace('surface');
              layout.closeDrawer();
            }}
          >
            <Paintbrush size={13} />
            Surface
          </button>
          <button
            type="button"
            aria-label="Model workspace"
            aria-pressed={workspace === 'model'}
            onClick={() => {
              setWorkspace('model');
              layout.closeDrawer();
            }}
          >
            <Boxes size={14} />
            Model
          </button>
        </nav>
        <div className="document-label">
          <FileBox size={15} />
          <span title={documentName}>{documentName}</span>
          {modified && <i role="img" aria-label="Modified recipe" title="Modified recipe" />}
        </div>
        <div className="document-actions" hidden={workspace === 'model'}>
          <button
            type="button"
            className="ui-icon file-action"
            aria-label="Load recipe"
            title="Open recipe (Ctrl/⌘ O)"
            onClick={() => fileInput.current?.click()}
          >
            <FolderOpen size={16} />
          </button>
          <button
            type="button"
            className="ui-icon file-action"
            aria-label="Save recipe"
            title="Save recipe (Ctrl/⌘ S)"
            onClick={saveRecipe}
          >
            <Save size={16} />
          </button>
          <span className="tool-divider file-action" />
          <button
            type="button"
            aria-label="Undo"
            title="Undo (Ctrl/⌘ Z)"
            className="ui-icon"
            disabled={!history.past.length}
            onClick={() => dispatch({ type: 'undo' })}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            aria-label="Redo"
            title="Redo (Ctrl/⌘ Shift Z)"
            className="ui-icon"
            disabled={!history.future.length}
            onClick={() => dispatch({ type: 'redo' })}
          >
            <Redo2 size={16} />
          </button>
        </div>
        <div className="build-actions">
          <label className="resolution-picker">
            <span className="sr-only">Bake resolution</span>
            <select
              id="resolution-select"
              value={resolution}
              title="Bake resolution"
              onChange={(e) =>
                addRecipe(
                  createGenerationRecipe(
                    { ...recipe.params, palette: [...recipe.params.palette], resolution: Number(e.target.value) },
                    recipe.version,
                  ),
                  'resolution',
                )
              }
            >
              {(sizes.includes(resolution) ? sizes : [resolution, ...sizes]).map((value) => (
                <option key={value} value={value}>
                  {value} px
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ui-button primary-button bake-button"
            aria-label={`Bake ${resolution} × ${resolution}`}
            title="Bake material (Ctrl/⌘ Enter)"
            onClick={() => render(recipe, 'bake')}
          >
            <Hammer size={15} />
            <span>Bake</span>
          </button>
          <button
            type="button"
            className="ui-button export-button"
            aria-label="Export maps"
            onClick={() => setModal('export')}
          >
            <ArrowDownToLine size={15} />
            <span>Export</span>
          </button>
        </div>
        <div className="layout-tools" hidden={workspace === 'model'}>
          <button
            type="button"
            className="dock-switch"
            aria-label="Material library"
            aria-pressed={layout.library || layout.drawer === 'library'}
            title="Material library"
            onClick={() => layout.toggle('library')}
          >
            <PanelLeft size={16} />
            <span>Library</span>
          </button>
          <button
            type="button"
            className="dock-switch"
            aria-label="Properties"
            aria-pressed={layout.properties || layout.drawer === 'properties'}
            title="Properties"
            onClick={() => layout.toggle('properties')}
          >
            <PanelRight size={16} />
            <span>Properties</span>
          </button>
        </div>
      </header>
      <div
        className="workbench"
        data-studio={workspace}
        style={
          {
            '--library-w': `${layout.layout.libraryWidth}px`,
            '--properties-w': `${layout.layout.propertiesWidth}px`,
          } as CSSProperties
        }
      >
        {workspace === 'surface' && layout.library && (
          <>
            <aside id="studio-library" className="library-dock">
              {library}
            </aside>
            <DockResize
              side="library"
              width={layout.layout.libraryWidth}
              onChange={(v) => layout.resize('library', v)}
              onCommit={(v) => layout.saveWidth('library', v)}
            />
          </>
        )}
        <main aria-label={workspace === 'model' ? 'Model workspace' : 'Material workspace'} className="workbench-main">
          {workspace === 'model' ? (
            <Suspense
              fallback={
                <div className="mw-wait" role="status">
                  Opening modeling studio…
                </div>
              }
            >
              <ModelWorkspace
                recipe={recipe}
                material={material}
                onRecipeChange={addRecipe}
                onBake={() => render(recipe, 'bake')}
                baking={Boolean(progress)}
                focused={layout.focused}
                onToggleFocus={layout.toggleFocus}
                onNotice={setNotice}
                initialHistory={modelSession.current}
                onHistoryChange={rememberModel}
              />
            </Suspense>
          ) : (
            <MaterialWorkspace material={material} focused={layout.focused} onToggleFocus={layout.toggleFocus} />
          )}
        </main>
        {workspace === 'surface' && layout.properties && (
          <>
            <DockResize
              side="properties"
              width={layout.layout.propertiesWidth}
              onChange={(v) => layout.resize('properties', v)}
              onCommit={(v) => layout.saveWidth('properties', v)}
            />
            <aside id="studio-properties" className="properties-dock">
              {properties}
            </aside>
          </>
        )}
      </div>
      <footer className="status-line" aria-hidden={modal || layout.drawer ? true : undefined}>
        <div className="session-status" role={statusError ? 'alert' : 'status'}>
          <i className={statusError ? 'state-error' : progress ? 'state-working' : 'state-ready'} />
          {statusError || (progress ? progress.stage : notice || 'Ready')}
          {importError && !error && (
            <button
              type="button"
              className="ui-icon"
              aria-label="Dismiss import error"
              onClick={() => setImportError('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
        {progress && (
          <div className="progress-track">
            <progress aria-label="Material render progress" max={1} value={progress.fraction} />
            <button className="ui-icon" type="button" aria-label="Cancel render" title="Cancel render" onClick={cancel}>
              <X size={13} />
            </button>
          </div>
        )}
        {!progress && material && (
          <span className="bake-state">
            {output === 'Full-resolution bake' ? 'Baked' : output === 'Previous render' ? 'Previous render' : 'Preview'}
            <b>{material.recipe.params.resolution} px</b>
          </span>
        )}
        <span className="status-engine">{recipe.version === 2 ? 'Studio v2' : 'Legacy v1'}</span>
        <code className="status-id">{id}</code>
        <button
          className="ui-icon shortcut-button"
          type="button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          onClick={() => setModal('shortcuts')}
        >
          <Keyboard size={15} />
        </button>
      </footer>
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        tabIndex={-1}
        aria-label="Load recipe JSON"
        accept=".json,application/json"
        onChange={(e) => {
          void importRecipe(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {layout.drawer && (
        <Dialog
          placement={layout.drawer === 'library' ? 'left' : 'right'}
          title={layout.drawer === 'library' ? 'Material library' : 'Properties'}
          hideHeader
          onClose={layout.closeDrawer}
        >
          {layout.drawer === 'library' ? library : properties}
        </Dialog>
      )}
      {modal === 'save' && <SaveMaterial name={documentName} onSave={saveLocal} onClose={() => setModal(null)} />}
      {modal === 'shortcuts' && (
        <Dialog title="Keyboard shortcuts" onClose={() => setModal(null)}>
          <div className="shortcut-list">
            {[
              ['Open recipe', 'Ctrl / ⌘ O'],
              ['Save recipe', 'Ctrl / ⌘ S'],
              ['Find materials', 'Ctrl / ⌘ K'],
              ['Bake material', 'Ctrl / ⌘ Enter'],
              ['Undo', 'Ctrl / ⌘ Z'],
              ['Redo', 'Ctrl / ⌘ Shift Z'],
              ['Focus workspace', 'Shift Space'],
              ['Close dialog', 'Esc'],
            ].map(([label, keys]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </div>
        </Dialog>
      )}
      <MaterialExports
        material={material}
        intendedRecipe={recipe}
        open={modal === 'export'}
        onClose={() => setModal(null)}
        onBake={() => render(recipe, 'bake')}
        progress={progress}
        renderError={error}
        onCancel={cancel}
      />
    </div>
  );
}
