import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { StudioMaps } from '../TextureGenerator';
import type { CompletedMaterial } from '../export/materialPackage';
import { serializeGenerationRecipe, type GenerationRecipe } from '../recipes';
import { bakeMaterial, releaseIdleWorker } from './bake';

const DRAFT_SIZE = 512;
const MAX_PREVIEW_SIZE = 1024;
type View = { material: CompletedMaterial | null; preview: CompletedMaterial | null };
const initialView: View = { material: null, preview: null };

function makeMaterial(recipe: GenerationRecipe, blobs: StudioMaps<Blob>): CompletedMaterial {
  const pairs: [string, string][] = [];
  try {
    for (const [channel, blob] of Object.entries(blobs)) pairs.push([channel, URL.createObjectURL(blob)]);
    return { recipe, blobs, urls: Object.fromEntries(pairs) as StudioMaps<string> };
  } catch (error) {
    for (const [, url] of pairs) URL.revokeObjectURL(url);
    throw error;
  }
}

function revoke(material: CompletedMaterial) {
  for (const url of Object.values(material.urls)) URL.revokeObjectURL(url);
}

export function useMaterialSession() {
  const [view, setView] = useState<View>(initialView);
  const [progress, setProgress] = useState<{ stage: string; fraction: number } | null>(null);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const latest = useRef<View>(initialView);
  const owned = useRef(new Set<CompletedMaterial>());

  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    setProgress(null);
  }, []);

  const render = useCallback((recipe: GenerationRecipe, mode: 'draft' | 'bake') => {
    active.current?.abort();
    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    setError('');
    const draft: GenerationRecipe = {
      ...recipe,
      params: { ...recipe.params, resolution: Math.min(DRAFT_SIZE, recipe.params.resolution) },
    };
    setProgress({ stage: mode === 'draft' ? 'Preparing preview' : 'Preparing bake', fraction: 0 });

    const unpublished = new Set<CompletedMaterial>();
    const publish = (material: CompletedMaterial, preview: CompletedMaterial) => {
      unpublished.delete(material);
      unpublished.delete(preview);
      latest.current = { material, preview };
      setView(latest.current);
    };
    const generate = async (target: GenerationRecipe) => {
      const key = serializeGenerationRecipe(target);
      for (const cached of [latest.current.material, latest.current.preview]) {
        if (cached && serializeGenerationRecipe(cached.recipe) === key) return cached;
      }
      const maps = await bakeMaterial(target, signal, (fraction, stage) => {
        if (!signal.aborted) setProgress({ fraction, stage });
      });
      signal.throwIfAborted();
      const result = makeMaterial(target, maps);
      owned.current.add(result);
      unpublished.add(result);
      return result;
    };

    // Edits share a short debounce. A requested final bake can start immediately.
    const timer = window.setTimeout(
      async () => {
        try {
          let preview: CompletedMaterial | null = null;
          if (mode === 'draft' || recipe.params.resolution > MAX_PREVIEW_SIZE) {
            preview = await generate(draft);
            signal.throwIfAborted();
            if (mode === 'draft') publish(preview, preview);
          }
          if (mode === 'bake') {
            const material = await generate(recipe);
            signal.throwIfAborted();
            publish(material, preview ?? material);
          }
        } catch (cause) {
          if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Material generation failed.');
        } finally {
          for (const entry of unpublished) {
            owned.current.delete(entry);
            revoke(entry);
          }
          if (!signal.aborted) {
            active.current = null;
            setProgress(null);
          }
        }
      },
      mode === 'draft' ? 160 : 0,
    );
    signal.addEventListener('abort', () => window.clearTimeout(timer), { once: true });
  }, []);

  useLayoutEffect(() => {
    if (latest.current !== view) return;
    for (const entry of owned.current) {
      if (entry !== view.material && entry !== view.preview) {
        revoke(entry);
        owned.current.delete(entry);
      }
    }
  }, [view]);

  useEffect(
    () => () => {
      active.current?.abort();
      releaseIdleWorker();
      for (const entry of owned.current) revoke(entry);
      owned.current.clear();
    },
    [],
  );

  return { ...view, render, cancel, progress, error };
}
