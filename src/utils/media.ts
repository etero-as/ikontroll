import type {
  AnnotationShape,
  LocaleModuleMediaMap,
  LocaleStringArrayMap,
  ModuleMediaItem,
  ModuleMediaPoolItem,
  ModuleMediaSelection,
  ModuleMediaSelections,
} from '@/types/course';

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const coerceMediaType = (type: ModuleMediaItem['type'] | undefined): ModuleMediaItem['type'] => {
  if (type === 'video' || type === 'document') {
    return type;
  }
  return 'image';
};

const normalizeMediaItem = (item: unknown): ModuleMediaItem | null => {
  if (!item) return null;
  if (typeof item === 'string') {
    return { id: randomId(), url: item, type: 'image' };
  }
  if (typeof item === 'object') {
    const maybe = item as Partial<ModuleMediaItem> & { url?: unknown; type?: unknown; id?: unknown };
    if (typeof maybe.url === 'string' && maybe.url.trim().length > 0) {
      const normalizedType = coerceMediaType(maybe.type as ModuleMediaItem['type'] | undefined);
      const normalized: ModuleMediaItem = {
        id: typeof maybe.id === 'string' && maybe.id.trim().length > 0 ? maybe.id : randomId(),
        url: maybe.url,
        type: normalizedType,
      };
      if (typeof maybe.caption === 'string' && maybe.caption.length > 0) {
        normalized.caption = maybe.caption;
      }
      if (Array.isArray(maybe.annotations) && maybe.annotations.length > 0) {
        normalized.annotations = maybe.annotations as AnnotationShape[];
      }
      return normalized;
    }
  }
  return null;
};

export const normalizeModuleMediaMap = (
  media: unknown,
  legacyImages?: LocaleStringArrayMap,
  legacyVideos?: LocaleStringArrayMap,
): LocaleModuleMediaMap => {
  const result: LocaleModuleMediaMap = {};
  if (media && typeof media === 'object') {
    Object.entries(media as Record<string, unknown>).forEach(([lang, entries]) => {
      if (Array.isArray(entries)) {
        const normalized = entries
          .map((entry) => normalizeMediaItem(entry))
          .filter((entry): entry is ModuleMediaItem => Boolean(entry));
        if (normalized.length) {
          result[lang] = normalized;
        }
      }
    });
  }

  if (Object.keys(result).length === 0) {
    const languages = new Set([
      ...Object.keys(legacyImages ?? {}),
      ...Object.keys(legacyVideos ?? {}),
    ]);
    languages.forEach((lang) => {
      const items: ModuleMediaItem[] = [];
      (legacyImages?.[lang] ?? []).forEach((url) => {
        if (url) items.push({ id: randomId(), url, type: 'image' });
      });
      (legacyVideos?.[lang] ?? []).forEach((url) => {
        if (url) items.push({ id: randomId(), url, type: 'video' });
      });
      if (items.length) {
        result[lang] = items;
      }
    });
  }

  return result;
};

export const ensureMediaLocales = (
  media: LocaleModuleMediaMap | undefined,
  languages: string[],
): LocaleModuleMediaMap => {
  const base: LocaleModuleMediaMap = {};
  languages.forEach((lang) => {
    base[lang] = media?.[lang]?.map((item) => {
      const normalized: ModuleMediaItem = {
        id: item.id ?? randomId(),
        url: item.url,
        type: coerceMediaType(item.type),
      };
      if (item.caption) {
        normalized.caption = item.caption;
      }
      if (Array.isArray(item.annotations) && item.annotations.length > 0) {
        normalized.annotations = item.annotations;
      }
      return normalized;
    }) ?? [];
  });
  return base;
};

export const mediaMapToLegacyArrays = (media: LocaleModuleMediaMap) => {
  const imageUrls: LocaleStringArrayMap = {};
  const videoUrls: LocaleStringArrayMap = {};
  Object.entries(media).forEach(([lang, items]) => {
    if (!Array.isArray(items)) return;
    imageUrls[lang] = items.filter((item) => item.type === 'image').map((item) => item.url);
    videoUrls[lang] = items.filter((item) => item.type === 'video').map((item) => item.url);
  });
  return { imageUrls, videoUrls };
};

export const getLocalizedMediaItems = (
  media: LocaleModuleMediaMap | undefined,
  locale: string,
): ModuleMediaItem[] => {
  if (!media) {
    return [];
  }
  const localized = media[locale];
  if (localized && localized.length) {
    return localized;
  }
  const norwegian = media.no;
  if (norwegian && norwegian.length) {
    return norwegian;
  }
  const fallbackKey = Object.keys(media).find((key) => media[key]?.length);
  if (fallbackKey) {
    return media[fallbackKey] ?? [];
  }
  return [];
};

const stripTimestampPrefix = (name: string): string =>
  name.replace(/^\d{10,}-/, '');

export const getFileNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    const segments = pathname.split('/');
    const candidate = segments.pop();
    return candidate && candidate.trim() ? stripTimestampPrefix(candidate) : parsed.hostname;
  } catch {
    const parts = url.split('/');
    return stripTimestampPrefix(decodeURIComponent(parts[parts.length - 1] || url));
  }
};

/* ------------------------------------------------------------------ */
/*  Pool-based media helpers                                          */
/* ------------------------------------------------------------------ */

/**
 * Derive a pool + per-language selections from the legacy per-language media map.
 * Used for on-read migration when a module has no `mediaPool` yet.
 */
export const normalizeToPoolModel = (
  media: LocaleModuleMediaMap | undefined,
  mediaSync: boolean | undefined,
): { pool: ModuleMediaPoolItem[]; selections: ModuleMediaSelections } => {
  if (!media || Object.keys(media).length === 0) {
    return { pool: [], selections: {} };
  }

  // Collect all unique assets across languages (dedup by id)
  const poolMap = new Map<string, ModuleMediaPoolItem>();
  const selections: ModuleMediaSelections = {};

  for (const [lang, items] of Object.entries(media)) {
    if (!Array.isArray(items)) continue;
    const langSelections: ModuleMediaSelection[] = [];

    for (const item of items) {
      if (!poolMap.has(item.id)) {
        const poolItem: ModuleMediaPoolItem = {
          id: item.id,
          url: item.url,
          type: item.type,
        };
        if (item.annotations?.length) poolItem.annotations = item.annotations;
        poolMap.set(item.id, poolItem);
      }
      const sel: ModuleMediaSelection = { assetId: item.id };
      if (item.caption) sel.caption = item.caption;
      langSelections.push(sel);
    }

    selections[lang] = langSelections;
  }

  const pool = Array.from(poolMap.values());

  // If sync was on, ensure every language selects all pool items
  if (mediaSync) {
    const allLangs = Object.keys(selections);
    const allIds = pool.map((p) => p.id);
    for (const lang of allLangs) {
      const existing = new Map(selections[lang].map((s) => [s.assetId, s]));
      selections[lang] = allIds.map((id) => existing.get(id) ?? { assetId: id });
    }
  }

  return { pool, selections };
};

/**
 * Reconstruct the legacy LocaleModuleMediaMap from pool + selections.
 * Used for backward-compat writes so consumer views keep working.
 */
export const poolModelToLegacyMedia = (
  pool: ModuleMediaPoolItem[],
  selections: ModuleMediaSelections,
  mediaSync: boolean,
): LocaleModuleMediaMap => {
  const poolById = new Map(pool.map((p) => [p.id, p]));
  const result: LocaleModuleMediaMap = {};

  if (mediaSync) {
    // All languages get all pool items
    const allLangs = Object.keys(selections);
    const fullItems: ModuleMediaItem[] = pool.map((p) => ({
      id: p.id,
      url: p.url,
      type: p.type,
      ...(p.annotations?.length ? { annotations: p.annotations } : {}),
    }));
    for (const lang of allLangs) {
      // Merge per-language captions onto the shared items
      const captionMap = new Map(
        (selections[lang] ?? []).filter((s) => s.caption).map((s) => [s.assetId, s.caption]),
      );
      result[lang] = fullItems.map((item) => {
        const caption = captionMap.get(item.id);
        return caption ? { ...item, caption } : item;
      });
    }
  } else {
    for (const [lang, sels] of Object.entries(selections)) {
      const items: ModuleMediaItem[] = [];
      for (const sel of sels) {
        const asset = poolById.get(sel.assetId);
        if (!asset) continue;
        const item: ModuleMediaItem = {
          id: asset.id,
          url: asset.url,
          type: asset.type,
          ...(sel.caption ? { caption: sel.caption } : {}),
          ...(asset.annotations?.length ? { annotations: asset.annotations } : {}),
        };
        items.push(item);
      }
      result[lang] = items;
    }
  }

  return result;
};

/**
 * Get media items for a specific locale from the pool model.
 * When sync is on, returns all pool items. When off, returns only selected items.
 * Merges per-language captions onto pool assets.
 */
export const getLocalizedMediaFromPool = (
  pool: ModuleMediaPoolItem[],
  selections: ModuleMediaSelections,
  locale: string,
  mediaSync: boolean,
): ModuleMediaItem[] => {
  if (!pool.length) return [];

  const poolById = new Map(pool.map((p) => [p.id, p]));

  if (mediaSync) {
    // All pool items, with captions from locale-specific selections
    const captionMap = new Map(
      (selections[locale] ?? []).filter((s) => s.caption).map((s) => [s.assetId, s.caption]),
    );
    return pool.map((p) => ({
      id: p.id,
      url: p.url,
      type: p.type,
      ...(captionMap.get(p.id) ? { caption: captionMap.get(p.id) } : {}),
      ...(p.annotations?.length ? { annotations: p.annotations } : {}),
    }));
  }

  // Sync off — only selected items for this locale
  const sels = selections[locale];
  if (!sels?.length) return [];

  const items: ModuleMediaItem[] = [];
  for (const sel of sels) {
    const asset = poolById.get(sel.assetId);
    if (!asset) continue;
    items.push({
      id: asset.id,
      url: asset.url,
      type: asset.type,
      ...(sel.caption ? { caption: sel.caption } : {}),
      ...(asset.annotations?.length ? { annotations: asset.annotations } : {}),
    });
  }
  return items;
};

