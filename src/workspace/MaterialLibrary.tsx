import {
  ArrowDownToLine,
  Bookmark,
  ChevronDown,
  FileBox,
  FolderOpen,
  Library,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { factoryMaterials, type LibraryMaterial } from './materialLibrary';

interface Props {
  saved: LibraryMaterial[];
  activeId?: string;
  onSelect: (item: LibraryMaterial) => void;
  onSave: () => void;
  onRemove: (id: string) => boolean;
  importError?: string;
  onImport: () => void;
  onDownload: () => void;
  searchRequest: number;
}

export function MaterialLibrary({
  saved,
  activeId,
  onSelect,
  onSave,
  onRemove,
  importError,
  onImport,
  onDownload,
  searchRequest,
}: Props) {
  const [filter, setFilter] = useState('');
  const [removing, setRemoving] = useState<LibraryMaterial | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const collectionSection = useRef<HTMLElement>(null);
  const focusAfterRemoval = useRef<number | null>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const index = focusAfterRemoval.current;
    if (removing || index === null) return;
    focusAfterRemoval.current = null;
    const entries = collectionSection.current?.querySelectorAll<HTMLButtonElement>('.saved-item');
    const target = entries?.length ? entries[Math.min(index, entries.length - 1)] : saveButton.current;
    target?.focus();
  }, [removing]);
  useEffect(() => {
    if (searchRequest) search.current?.focus();
  }, [searchRequest]);
  const matches = ({ name, recipe }: LibraryMaterial) =>
    `${name} ${recipe.params.style}`.toLowerCase().includes(filter.trim().toLowerCase());
  const presets = factoryMaterials.filter(matches);
  const collection = saved.filter(matches);
  return (
    <section aria-label="Material library" className="library-content">
      <div className="dock-heading">
        <Library size={16} />
        <h2>Material library</h2>
      </div>
      <div className="library-search">
        <Search size={14} />
        <input
          ref={search}
          type="search"
          aria-label="Find materials"
          placeholder="Find materials…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <button
            className="ui-icon"
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setFilter('');
              search.current?.focus();
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="library-scroll">
        <details open className="library-group">
          <summary>
            <ChevronDown size={13} />
            <span>Factory presets</span>
            <span className="group-count">{presets.length}</span>
          </summary>
          <div className="preset-list">
            {presets.map((item) => (
              <button
                key={item.id}
                type="button"
                className="preset-card"
                aria-label={item.name}
                aria-pressed={activeId === item.id}
                onClick={() => onSelect(item)}
              >
                <img src={item.image} alt="" width={480} height={248} />
                <span className="preset-name">{item.name}</span>
                <span className="preset-type">
                  {item.recipe.params.style === 'tech' ? 'Hard surface' : 'Electrical'}
                  <span>2K</span>
                </span>
              </button>
            ))}
            {!presets.length && <p className="library-note">No matching presets.</p>}
          </div>
        </details>
        <section ref={collectionSection} className="saved-library" aria-label="Saved materials">
          <div className="library-section-title">
            <Bookmark size={14} />
            <h3>Saved materials</h3>
            <span className="group-count">{collection.length}</span>
          </div>
          {collection.map((item) => (
            <div key={item.id} className="saved-entry">
              <button
                type="button"
                className="saved-item"
                aria-label={item.name}
                aria-pressed={activeId === item.id}
                onClick={() => onSelect(item)}
              >
                <span className="saved-swatch" aria-hidden="true">
                  {item.recipe.params.palette.slice(0, 5).map((color, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: A palette can repeat a color, and the stripe follows its slot.
                    <i key={i} style={{ backgroundColor: `#${color.replace(/^#/, '')}` }} />
                  ))}
                </span>
                <span>{item.name}</span>
              </button>
              <button
                type="button"
                className="ui-icon remove-entry"
                aria-label={`Remove ${item.name}`}
                title="Remove from library"
                onClick={() => {
                  setRemoveFailed(false);
                  setRemoving(item);
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {filter && !collection.length && saved.length > 0 && (
            <p className="library-note">No matching saved materials.</p>
          )}
          <button ref={saveButton} type="button" className="save-to-library" onClick={onSave}>
            <Plus size={14} />
            Save to library
          </button>
        </section>
      </div>
      {importError && (
        <p role="alert" className="form-error library-file-error">
          {importError}
        </p>
      )}
      <div className="library-files">
        <button className="library-import" type="button" onClick={onImport}>
          <FolderOpen size={15} />
          Import recipe…
        </button>
        <button
          type="button"
          className="ui-icon"
          aria-label="Download recipe JSON"
          title="Save recipe JSON"
          onClick={onDownload}
        >
          <ArrowDownToLine size={15} />
        </button>
      </div>
      {removing && (
        <Dialog title="Remove saved material" onClose={() => setRemoving(null)}>
          <div className="dialog-body">
            <p>
              Remove <strong>{removing.name}</strong> from this browser’s material library?
            </p>
            {removeFailed && (
              <p role="alert" className="form-error">
                Could not remove this material from browser storage.
              </p>
            )}
            <div className="dialog-actions">
              <button type="button" className="ui-button" onClick={() => setRemoving(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="ui-button warn-button"
                onClick={() => {
                  if (onRemove(removing.id)) {
                    focusAfterRemoval.current = Math.max(
                      0,
                      collection.findIndex((item) => item.id === removing.id),
                    );
                    setRemoving(null);
                  } else setRemoveFailed(true);
                }}
              >
                Remove material
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </section>
  );
}

export function SaveMaterial({
  name,
  onSave,
  onClose,
}: {
  name: string;
  onSave: (name: string) => string | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    nameInput.current?.focus();
    nameInput.current?.select();
  }, []);
  return (
    <Dialog title="Save to library" onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = value.trim();
          if (!trimmed) {
            setError('Enter a material name.');
            return;
          }
          const failure = onSave(trimmed);
          if (failure) setError(failure);
          else onClose();
        }}
      >
        <label htmlFor="saved-name">Material name</label>
        <input
          id="saved-name"
          ref={nameInput}
          type="text"
          maxLength={96}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
        <p className="form-note">
          <FileBox size={15} />
          Stores this recipe in this browser.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="ui-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="ui-button primary-button">
            Save material
          </button>
        </div>
      </form>
    </Dialog>
  );
}
