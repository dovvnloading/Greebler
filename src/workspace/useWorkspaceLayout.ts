import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { dockLimits } from './DockResize';

type Side = keyof typeof dockLimits;
const layoutKey = 'greebler.workspace.layout.v1';
const defaults = {
  libraryWidth: dockLimits.library.initial as number,
  propertiesWidth: dockLimits.properties.initial as number,
  library: true,
  properties: true,
};

function loadLayout() {
  try {
    const raw = JSON.parse(localStorage.getItem(layoutKey) ?? '{}');
    const result = { ...defaults };
    for (const side of ['library', 'properties'] as const) {
      const key = `${side}Width` as const;
      const value = raw[key];
      if (Number.isFinite(value))
        result[key] = Math.max(dockLimits[side].min, Math.min(dockLimits[side].max, Math.round(value)));
      if (typeof raw[side] === 'boolean') result[side] = raw[side];
    }
    return result;
  } catch {
    return { ...defaults };
  }
}

function useWide(query: string) {
  const listen = useCallback(
    (update: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    },
    [query],
  );
  return useSyncExternalStore(
    listen,
    () => window.matchMedia(query).matches,
    () => true,
  );
}

export function useWorkspaceLayout() {
  const [layout, setLayout] = useState(loadLayout);
  const [focused, setFocused] = useState(false);
  const [drawer, setDrawer] = useState<Side | null>(null);
  const [revision, setRevision] = useState(0);
  const wideLibrary = useWide('(min-width: 1100px)');
  const wideProperties = useWide('(min-width: 800px)');
  const wide = { library: wideLibrary, properties: wideProperties };
  useEffect(() => {
    if ((drawer === 'library' && wideLibrary) || (drawer === 'properties' && wideProperties)) setDrawer(null);
  }, [drawer, wideLibrary, wideProperties]);
  function update(next: typeof layout) {
    setLayout(next);
    try {
      localStorage.setItem(layoutKey, JSON.stringify(next));
    } catch {
      /* Layout is still usable without storage. */
    }
  }
  function toggle(side: Side) {
    if (!wide[side]) {
      setDrawer((d) => (d === side ? null : side));
      return;
    }
    if (focused) {
      setFocused(false);
      update({ ...layout, [side]: true });
    } else update({ ...layout, [side]: !layout[side] });
  }
  function findMaterials() {
    if (wide.library) {
      setFocused(false);
      update({ ...layout, library: true });
    } else setDrawer('library');
    setRevision((n) => n + 1);
  }
  return {
    layout,
    focused,
    toggleFocus: () => {
      setDrawer(null);
      setFocused((v) => !v);
    },
    library: wide.library && layout.library && !focused,
    properties: wide.properties && layout.properties && !focused,
    drawer: drawer && !wide[drawer] ? drawer : null,
    closeDrawer: () => setDrawer(null),
    toggle,
    findMaterials,
    searchRequest: revision,
    resize: (side: Side, value: number) => setLayout((v) => ({ ...v, [`${side}Width`]: value })),
    saveWidth: (side: Side, value: number) => update({ ...layout, [`${side}Width`]: value }),
  };
}
