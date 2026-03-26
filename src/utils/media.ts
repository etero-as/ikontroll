import type {
  LocaleModuleMediaMap,
  LocaleStringArrayMap,
  ModuleMediaItem,
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
      return {
        id: typeof maybe.id === 'string' && maybe.id.trim().length > 0 ? maybe.id : randomId(),
        url: maybe.url,
        type: normalizedType,
      };
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
    base[lang] = media?.[lang]?.map((item) => ({
      id: item.id ?? randomId(),
      url: item.url,
      type: coerceMediaType(item.type),
    })) ?? [];
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

export const getFileNameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    const segments = pathname.split('/');
    const candidate = segments.pop();
    return candidate && candidate.trim() ? candidate : parsed.hostname;
  } catch {
    const parts = url.split('/');
    return decodeURIComponent(parts[parts.length - 1] || url);
  }
};

