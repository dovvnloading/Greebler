import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CompletedMaterial } from '../export/materialPackage';
import { type GenerationRecipe, serializeGenerationRecipe } from '../recipes';
import type { StudioMaps } from '../TextureGenerator';
import { bakeMaterial, releaseIdleWorker } from './bake';

const DRAFT_SIZE = 512;
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
  const [material, setMaterial] = useState<CompletedMaterial | null>(null);
  const [progress, setProgress] = useState<{ stage: string; fraction: number } | null>(null);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const latest = useRef<CompletedMaterial | null>(null);
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
    const target: GenerationRecipe =
      mode === 'bake'
        ? recipe
        : {
            ...recipe,
            params: { ...recipe.params, resolution: Math.min(DRAFT_SIZE, recipe.params.resolution) },
          };
    setProgress({ stage: mode === 'draft' ? 'Preparing preview' : 'Preparing bake', fraction: 0 });

    // Edits share a short debounce. A requested final bake can start immediately.
    const timer = window.setTimeout(
      async () => {
        try {
          const cached = latest.current;
          if (cached && serializeGenerationRecipe(cached.recipe) === serializeGenerationRecipe(target)) return;
          const maps = await bakeMaterial(target, signal, (fraction, stage) => {
            if (!signal.aborted) setProgress({ fraction, stage });
          });
          signal.throwIfAborted();
          const next = makeMaterial(target, maps);
          owned.current.add(next);
          latest.current = next;
          setMaterial(next);
        } catch (cause) {
          if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Material generation failed.');
        } finally {
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
    if (latest.current !== material) return;
    for (const entry of owned.current) {
      if (entry !== material) {
        revoke(entry);
        owned.current.delete(entry);
      }
    }
  }, [material]);

  useEffect(
    () => () => {
      active.current?.abort();
      releaseIdleWorker();
      for (const entry of owned.current) revoke(entry);
      owned.current.clear();
    },
    [],
  );

  return { material, render, cancel, progress, error };
}
