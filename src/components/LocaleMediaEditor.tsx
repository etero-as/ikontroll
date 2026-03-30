'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import type { ChangeEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import DragHandle, { DragHandleIcon } from '@/components/DragHandle';
import SelectWithToggleIcon from '@/components/SelectWithToggleIcon';
import ImageAnnotationEditor from '@/components/ImageAnnotationEditor';
import AnnotatedImage from '@/components/AnnotatedImage';
import { ensureMediaLocales, getFileNameFromUrl, poolModelToLegacyMedia } from '@/utils/media';
import MediaPicker from '@/components/MediaPicker';
import type {
  ModuleMediaItem,
  ModuleMediaPoolItem,
  ModuleMediaSelections,
  ModuleMediaType,
  AnnotationShape,
} from '@/types/course';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const generateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const sanitizeFileName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'fil';

const buildModuleAssetPath = (
  courseId: string,
  moduleId: string,
  type: 'images' | 'videos' | 'documents',
  file: File,
) =>
  `courses/${courseId}/modules/${moduleId}/${type}/${Date.now()}-${sanitizeFileName(file.name)}`;

const isYouTubeUrl = (url: string): boolean =>
  /youtu\.be|youtube\.com/.test(url.toLowerCase());

/**
 * Merge pool assets with per-language selections to produce display items.
 */
const resolveItems = (
  pool: ModuleMediaPoolItem[],
  selections: ModuleMediaSelections,
  language: string,
  mediaSync: boolean,
): ModuleMediaItem[] => {
  const poolById = new Map(pool.map((p) => [p.id, p]));

  if (mediaSync) {
    // Show all pool items, with captions from this language's selections
    const captionMap = new Map(
      (selections[language] ?? []).filter((s) => s.caption).map((s) => [s.assetId, s.caption]),
    );
    return pool.map((p) => ({
      id: p.id,
      url: p.url,
      type: p.type,
      ...(captionMap.get(p.id) ? { caption: captionMap.get(p.id) } : {}),
      ...(p.annotations?.length ? { annotations: p.annotations } : {}),
    }));
  }

  // Sync off — only selected items for this language
  const sels = selections[language] ?? [];
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

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

const LocaleEditorHeader = ({ label, activeLanguage }: { label: string; activeLanguage: string }) => (
  <div className="flex items-center justify-between">
    <p className="text-sm font-semibold text-slate-700">{label}</p>
    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
      {activeLanguage.toUpperCase()}
    </span>
  </div>
);

const MediaErrorFallback = ({ url, type }: { url: string; type: ModuleMediaItem['type'] }) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const config = {
    image: { icon: '🖼️', label: t.admin.moduleDetail.imageUnavailableTitle, message: t.admin.moduleDetail.imageUnavailableMsg },
    video: { icon: '🎥', label: t.admin.moduleDetail.videoUnavailableTitle, message: t.admin.moduleDetail.videoUnavailableMsg },
    document: { icon: '📄', label: t.admin.moduleDetail.documentUnavailableTitle, message: t.admin.moduleDetail.documentUnavailableMsg },
  };
  const { icon, label, message } = config[type];
  const filename = getFileNameFromUrl(url);
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-slate-400">
      <span className="text-3xl" role="img" aria-label={label}>{icon}</span>
      <p className="text-xs font-semibold text-slate-600">{message}</p>
      <p className="text-[10px] font-mono text-slate-500 break-all">
        <span className="font-semibold not-italic">{t.admin.moduleDetail.fileNamePrefix}</span>{filename}
      </p>
    </div>
  );
};

const MediaDragOverlay = memo(({ item }: { item: ModuleMediaItem }) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const typeLabel =
    item.type === 'video' ? t.admin.moduleDetail.mediaTypeVideo : item.type === 'document' ? t.admin.moduleDetail.mediaTypeDocument : t.admin.moduleDetail.mediaTypeImage;
  const documentName = item.type === 'document' ? getFileNameFromUrl(item.url) : null;

  return (
    <div className="space-y-3 rounded-2xl border border-slate-300 bg-white p-4 shadow-2xl ring-2 ring-slate-300 cursor-grabbing opacity-95">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
        <span className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-1.5 text-slate-400">
          <DragHandleIcon />
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-600">
          {typeLabel}
        </span>
      </div>
      <div className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 h-48">
        {item.type === 'image' ? (
          item.annotations?.length ? (
            <AnnotatedImage
              src={item.url}
              alt=""
              annotations={item.annotations}
              className="h-full w-full"
            />
          ) : (
            <Image fill src={item.url} alt="" className="object-contain" sizes="(max-width: 768px) 100vw, 33vw" />
          )
        ) : item.type === 'video' ? (
          <div className="flex h-full w-full items-center justify-center text-4xl">🎥</div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-slate-600">
            <span className="text-4xl">📄</span>
            <p className="text-xs font-semibold break-all">{documentName ?? t.admin.moduleDetail.mediaTypeDocument}</p>
          </div>
        )}
      </div>
    </div>
  );
});
MediaDragOverlay.displayName = 'MediaDragOverlay';

const SortableMediaCard = ({
  item,
  onRemove,
  onCaptionChange,
  onEdit,
  onOpen,
  onReplace,
  isTarget,
}: {
  item: ModuleMediaItem;
  onRemove: () => void;
  onCaptionChange: (caption: string) => void;
  onEdit: () => void;
  onOpen: () => void;
  onReplace: () => void;
  isTarget: boolean;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: item.id });
  const [mediaError, setMediaError] = useState(false);
  // Probe the raw URL directly (bypasses Next.js image optimization cache)
  // so we catch images that appear visually fine but have a broken source URL.
  useEffect(() => {
    setMediaError(false);
    if (item.type !== 'image') return;
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => { /* URL is reachable */ };
    probe.onerror = () => { if (!cancelled) setMediaError(true); };
    probe.src = item.url;
    return () => { cancelled = true; probe.src = ''; };
  }, [item.url, item.type]);

  const handleOpenClick = useCallback(() => {
    if (item.type === 'image' && mediaError) {
      onReplace();
      return;
    }
    onOpen();
  }, [item.type, mediaError, onOpen, onReplace]);

  const typeLabel =
    item.type === 'video' ? t.admin.moduleDetail.mediaTypeVideo : item.type === 'document' ? t.admin.moduleDetail.mediaTypeDocument : t.admin.moduleDetail.mediaTypeImage;
  const documentName = item.type === 'document' ? getFileNameFromUrl(item.url) : null;

  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 h-full min-h-70"
        style={{ visibility: 'hidden' }}
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`space-y-3 rounded-2xl border bg-white p-4 shadow-sm transition-transform duration-200 ${
        isTarget
          ? 'border-indigo-400 ring-2 ring-indigo-300 bg-indigo-50 scale-[1.03]'
          : 'border-slate-200 scale-100'
      }`}
    >
      <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
        <DragHandle attributes={attributes} listeners={listeners} />
        <div className="flex items-center gap-2">
          {isTarget && (
            <span className="rounded-full bg-indigo-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
              {t.admin.moduleDetail.swapMedia}
            </span>
          )}
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-600">
            {typeLabel}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 h-48">
          {mediaError ? (
            <MediaErrorFallback url={item.url} type={item.type} />
          ) : item.type === 'image' ? (
            item.annotations?.length ? (
              <AnnotatedImage
                src={item.url}
                alt={t.admin.moduleDetail.previewMediaAlt}
                annotations={item.annotations}
                className="h-full w-full"
              />
            ) : (
              <Image
                fill
                src={item.url}
                alt={t.admin.moduleDetail.previewMediaAlt}
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 33vw"
                onError={() => setMediaError(true)}
              />
            )
          ) : item.type === 'video' ? (
            isYouTubeUrl(item.url) ? (
              <iframe
                src={item.url}
                title={t.admin.moduleDetail.mediaTypeVideo}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            ) : (
              <video
                controls
                className="h-full w-full object-cover"
                onError={() => setMediaError(true)}
              >
                <source src={item.url} />
                {t.admin.moduleDetail.videoNotSupported}
              </video>
            )
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center text-slate-600">
              <span className="text-4xl" role="img" aria-label={t.admin.moduleDetail.mediaTypeDocument}>
                📄
              </span>
              <p className="text-xs font-semibold wrap-break-word">{documentName ?? t.admin.moduleDetail.mediaTypeDocument}</p>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {mediaError && item.type === 'image' ? (
              <button
                type="button"
                onClick={onReplace}
                className="cursor-pointer rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:border-amber-400 hover:bg-amber-100"
              >
                {t.admin.brokenMedia.replaceButton}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleOpenClick}
                className="cursor-pointer rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              >
                {t.common.open}
              </button>
            )}
            {item.type === 'image' && !mediaError && (
              <button
                type="button"
                onClick={onEdit}
                className="cursor-pointer rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              >
                {t.admin.moduleDetail.editAnnotations}
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              className="cursor-pointer rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50"
            >
              {t.common.remove}
            </button>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">
              {item.type === 'video'
                ? t.admin.moduleDetail.mediaCaptionLabelVideo
                : item.type === 'document'
                  ? t.admin.moduleDetail.mediaCaptionLabelDocument
                  : t.admin.moduleDetail.mediaCaptionLabelImage}
            </span>
            <input
              type="text"
              value={item.caption ?? ''}
              onChange={(e) => onCaptionChange(e.target.value)}
              placeholder={
                item.type === 'video'
                  ? t.admin.moduleDetail.mediaCaptionPlaceholderVideo
                  : item.type === 'document'
                    ? t.admin.moduleDetail.mediaCaptionPlaceholderDocument
                    : t.admin.moduleDetail.mediaCaptionPlaceholderImage
              }
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
          </label>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Main component                                                    */
/* ------------------------------------------------------------------ */

export interface LocaleMediaEditorProps {
  label: string;
  pool: ModuleMediaPoolItem[];
  selections: ModuleMediaSelections;
  onPoolChange: (pool: ModuleMediaPoolItem[]) => void;
  onSelectionsChange: (selections: ModuleMediaSelections) => void;
  activeLanguage: string;
  courseId: string;
  moduleId: string;
  languages: string[];
  mediaSync: boolean;
  onMediaSyncChange: (next: boolean) => void;
}

const LocaleMediaEditor = ({
  label,
  pool,
  selections,
  onPoolChange,
  onSelectionsChange,
  activeLanguage,
  courseId,
  moduleId,
  languages,
  mediaSync,
  onMediaSyncChange,
}: LocaleMediaEditorProps) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);

  // Resolve display items from pool + selections
  const items = useMemo(
    () => resolveItems(pool, selections, activeLanguage, mediaSync),
    [pool, selections, activeLanguage, mediaSync],
  );

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<'image' | 'video' | 'document' | null>(null);
  const [editingItem, setEditingItem] = useState<ModuleMediaItem | null>(null);
  const [previewItem, setPreviewItem] = useState<ModuleMediaItem | null>(null);
  const [replaceItem, setReplaceItem] = useState<ModuleMediaItem | null>(null);
  const [replaceUploading, setReplaceUploading] = useState(false);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Refs for latest values in callbacks
  const poolRef = useRef(pool);
  const selectionsRef = useRef(selections);
  const languagesRef = useRef(languages);
  const activeLanguageRef = useRef(activeLanguage);
  const mediaSyncRef = useRef(mediaSync);

  useEffect(() => { poolRef.current = pool; }, [pool]);
  useEffect(() => { selectionsRef.current = selections; }, [selections]);
  useEffect(() => { languagesRef.current = languages; }, [languages]);
  useEffect(() => { activeLanguageRef.current = activeLanguage; }, [activeLanguage]);
  useEffect(() => { mediaSyncRef.current = mediaSync; }, [mediaSync]);

  /* ---- Reuse from other language (sync OFF) ---- */
  const [reuseSourceLang, setReuseSourceLang] = useState('');

  const langsWithMedia = useMemo(
    () => languages.filter((lang) => lang !== activeLanguage && (selections[lang] ?? []).length > 0),
    [languages, activeLanguage, selections],
  );

  const effectiveReuseSource = langsWithMedia.includes(reuseSourceLang)
    ? reuseSourceLang
    : langsWithMedia[0] ?? '';

  /* ---- Pool & selection update helpers ---- */

  /** Add an asset to the pool and select it for the given languages. */
  const addToPool = useCallback(
    (asset: ModuleMediaPoolItem, selectForLanguages: string[]) => {
      const nextPool = [...poolRef.current, asset];
      onPoolChange(nextPool);

      if (selectForLanguages.length > 0) {
        const nextSels = { ...selectionsRef.current };
        for (const lang of selectForLanguages) {
          nextSels[lang] = [...(nextSels[lang] ?? []), { assetId: asset.id }];
        }
        onSelectionsChange(nextSels);
      }
    },
    [onPoolChange, onSelectionsChange],
  );

  /** Remove an asset from the pool entirely (sync ON delete). */
  const removeFromPool = useCallback(
    (assetId: string) => {
      onPoolChange(poolRef.current.filter((p) => p.id !== assetId));
      // Also remove from all language selections
      const nextSels = { ...selectionsRef.current };
      for (const lang of Object.keys(nextSels)) {
        nextSels[lang] = nextSels[lang].filter((s) => s.assetId !== assetId);
      }
      onSelectionsChange(nextSels);
    },
    [onPoolChange, onSelectionsChange],
  );

  /** Deselect an asset for the active language only (sync OFF remove). */
  const deselectForLanguage = useCallback(
    (assetId: string, lang: string) => {
      const nextSels = { ...selectionsRef.current };
      nextSels[lang] = (nextSels[lang] ?? []).filter((s) => s.assetId !== assetId);
      onSelectionsChange(nextSels);
    },
    [onSelectionsChange],
  );

  /** Update the order of selections for the active language. */
  const reorderSelections = useCallback(
    (reorderedItems: ModuleMediaItem[]) => {
      const lang = activeLanguageRef.current;
      const currentSels = selectionsRef.current[lang] ?? [];
      const captionMap = new Map(currentSels.filter((s) => s.caption).map((s) => [s.assetId, s.caption]));

      if (mediaSyncRef.current) {
        // When synced, reorder the pool itself
        const poolById = new Map(poolRef.current.map((p) => [p.id, p]));
        const nextPool = reorderedItems
          .map((item) => poolById.get(item.id))
          .filter((p): p is ModuleMediaPoolItem => Boolean(p));
        // Add any pool items not in the reordered list (shouldn't happen, but safety)
        for (const p of poolRef.current) {
          if (!nextPool.some((np) => np.id === p.id)) nextPool.push(p);
        }
        onPoolChange(nextPool);
      } else {
        // Reorder just this language's selections
        const nextSels = { ...selectionsRef.current };
        nextSels[lang] = reorderedItems.map((item) => ({
          assetId: item.id,
          ...(captionMap.get(item.id) ? { caption: captionMap.get(item.id) } : {}),
        }));
        onSelectionsChange(nextSels);
      }
    },
    [onPoolChange, onSelectionsChange],
  );

  /** Update caption for the active language's selection. */
  const updateCaption = useCallback(
    (assetId: string, caption: string) => {
      const lang = activeLanguageRef.current;
      const nextSels = { ...selectionsRef.current };
      const langSels = nextSels[lang] ?? [];
      const exists = langSels.some((s) => s.assetId === assetId);

      if (exists) {
        nextSels[lang] = langSels.map((s) => {
          if (s.assetId !== assetId) return s;
          if (caption) return { ...s, caption };
          return { assetId: s.assetId };
        });
      } else {
        // When sync is ON, the language may not have an explicit selection entry yet.
        // Create one so the per-language caption is persisted.
        nextSels[lang] = [...langSels, caption ? { assetId, caption } : { assetId }];
      }

      onSelectionsChange(nextSels);
    },
    [onSelectionsChange],
  );

  /** Update annotations on a pool asset. */
  const updatePoolAsset = useCallback(
    (assetId: string, annotations: AnnotationShape[]) => {
      onPoolChange(
        poolRef.current.map((p) => {
          if (p.id !== assetId) return p;
          const next = { ...p };
          if (annotations.length) {
            next.annotations = annotations;
          } else {
            delete next.annotations;
          }
          return next;
        }),
      );
    },
    [onPoolChange],
  );

  /* ---- Replace broken URL ---- */

  const replaceUrlInPool = useCallback(
    (oldUrl: string, newUrl: string) => {
      onPoolChange(
        poolRef.current.map((p) => p.url === oldUrl ? { ...p, url: newUrl } : p),
      );
    },
    [onPoolChange],
  );

  const handleReplaceUpload = useCallback(
    async (file: File) => {
      if (!replaceItem) return;
      setReplaceUploading(true);
      try {
        const storagePath = buildModuleAssetPath(courseId, moduleId, 'images', file);
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const newUrl = await getDownloadURL(storageRef);

        // 1. Compute the updated pool
        const newPool = poolRef.current.map((p) =>
          p.url === replaceItem.url ? { ...p, url: newUrl } : p,
        );

        // 2. Derive the full legacy media map for ALL languages so every
        //    language (EN, ES, …) gets the new URL immediately — not only
        //    after a manual "Lagre" click.
        const legacyMedia = poolModelToLegacyMedia(
          newPool,
          selectionsRef.current,
          mediaSyncRef.current,
        );
        const normalizedMedia = ensureMediaLocales(legacyMedia, languagesRef.current);

        // 3. Write to Firestore straight away
        await updateDoc(doc(db, 'courses', courseId, 'modules', moduleId), {
          mediaPool: newPool,
          media: normalizedMedia,
          updatedAt: serverTimestamp(),
        });

        // 4. Update React state so the UI reflects the change without reload
        replaceUrlInPool(replaceItem.url, newUrl);
        setReplaceItem(null);
      } catch (err) {
        console.error('Replace upload failed', err);
      } finally {
        setReplaceUploading(false);
      }
    },
    [replaceItem, courseId, moduleId, replaceUrlInPool],
  );

  /* ---- Sync toggle ---- */

  const handleSyncToggle = () => {
    if (mediaSync) {
      // ON → OFF: snapshot current full pool as each language's selection
      const nextSels: ModuleMediaSelections = {};
      const allAssetIds = poolRef.current.map((p) => p.id);
      for (const lang of languagesRef.current) {
        const existing = selectionsRef.current[lang] ?? [];
        const captionMap = new Map(existing.filter((s) => s.caption).map((s) => [s.assetId, s.caption]));
        nextSels[lang] = allAssetIds.map((id) => ({
          assetId: id,
          ...(captionMap.get(id) ? { caption: captionMap.get(id) } : {}),
        }));
      }
      onSelectionsChange(nextSels);
      mediaSyncRef.current = false;
      onMediaSyncChange(false);
      return;
    }

    // OFF → ON: all languages see full pool, override deselections
    mediaSyncRef.current = true;
    onMediaSyncChange(true);
  };

  /* ---- Drag & drop ---- */

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<ModuleMediaItem | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveId(id);
    setActiveItem(items.find((item) => item.id === id) ?? null);
    setOverId(null);
  }, [items]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const newOverId = event.over ? String(event.over.id) : null;
    const currentActiveId = event.active ? String(event.active.id) : null;
    setOverId(newOverId && newOverId !== currentActiveId ? newOverId : null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveItem(null);
    setOverId(null);
    if (!over || active.id === over.id) return;
    const draggedIdx = items.findIndex((item) => item.id === active.id);
    const targetIdx = items.findIndex((item) => item.id === over.id);
    if (draggedIdx === -1 || targetIdx === -1) return;
    const swapped = [...items];
    [swapped[draggedIdx], swapped[targetIdx]] = [swapped[targetIdx], swapped[draggedIdx]];
    reorderSelections(swapped);
  }, [items, reorderSelections]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setActiveItem(null);
    setOverId(null);
  }, []);

  /* ---- File deletion from storage ---- */

  const maybeDeleteUploadedFile = useCallback(async (url: string) => {
    if (!url.includes('firebasestorage.googleapis.com')) return;
    try {
      const urlObj = new URL(url);
      const match = urlObj.pathname.match(/\/v0\/b\/([^/]+)\/o\/(.+)/);
      if (!match) return;
      const [, bucket, encodedPath] = match;
      const configuredBucket = storage.app.options?.storageBucket;
      if (configuredBucket && bucket !== configuredBucket) {
        return;
      }
      const objectPath = decodeURIComponent(encodedPath);
      await deleteObject(ref(storage, objectPath));
    } catch (err) {
      console.warn('Kunne ikke slette opplastet fil', err);
    }
  }, []);

  /* ---- Remove / delete ---- */

  const [pendingSyncDelete, setPendingSyncDelete] = useState<{
    id: string;
    url: string;
  } | null>(null);

  const confirmSyncDelete = () => {
    if (!pendingSyncDelete) return;
    const { id, url } = pendingSyncDelete;
    removeFromPool(id);
    void maybeDeleteUploadedFile(url);
    setPendingSyncDelete(null);
  };

  const handleRemove = (id: string) => {
    const target = items.find((item) => item.id === id);
    if (!target) return;

    if (mediaSync) {
      // Sync ON: delete from pool entirely (warn user)
      setPendingSyncDelete({ id, url: target.url });
      return;
    }

    // Sync OFF: deselect for this language only
    deselectForLanguage(id, activeLanguage);

    // If no other language references this asset, delete from storage
    const otherLangsHaveIt = Object.entries(selectionsRef.current).some(
      ([lang, sels]) => lang !== activeLanguage && sels.some((s) => s.assetId === id),
    );
    if (!otherLangsHaveIt) {
      // Check if it's still in any language after our deselection
      // (we already removed it from activeLanguage via deselectForLanguage)
      void maybeDeleteUploadedFile(target.url);
    }
  };

  /* ---- Reuse from other language ---- */

  const reuseInfo = useMemo(() => {
    if (!effectiveReuseSource) return { missing: 0, total: 0 };
    const sourceSelections = selections[effectiveReuseSource] ?? [];
    if (sourceSelections.length === 0) return { missing: 0, total: 0 };
    const activeIds = new Set((selections[activeLanguage] ?? []).map((s) => s.assetId));
    const missing = sourceSelections.filter((s) => !activeIds.has(s.assetId)).length;
    return { missing, total: sourceSelections.length };
  }, [effectiveReuseSource, selections, activeLanguage]);

  const alreadyReused = reuseInfo.total > 0 && reuseInfo.missing === 0;

  const reuseButtonLabel = alreadyReused
    ? t.admin.moduleDetail.mediaAlreadyReused
    : reuseInfo.missing > 0 && reuseInfo.missing < reuseInfo.total
      ? t.admin.moduleDetail.mediaReuseMissing(reuseInfo.missing)
      : t.admin.moduleDetail.mediaReuseFrom;

  const handleReuse = (requireConfirm: boolean) => {
    const sourceLang = effectiveReuseSource;
    if (!sourceLang) return;
    const sourceSelections = selectionsRef.current[sourceLang] ?? [];
    const currentSelections = selectionsRef.current[activeLanguageRef.current] ?? [];
    const currentIds = new Set(currentSelections.map((s) => s.assetId));
    const missingSelections = sourceSelections.filter((s) => !currentIds.has(s.assetId));
    const isPartialOverlap = missingSelections.length > 0 && missingSelections.length < sourceSelections.length;

    if (isPartialOverlap) {
      const nextSels = { ...selectionsRef.current };
      nextSels[activeLanguageRef.current] = [...currentSelections, ...missingSelections];
      onSelectionsChange(nextSels);
      return;
    }
    if (requireConfirm) {
      const confirmed = window.confirm(
        t.admin.moduleDetail.mediaReuseConfirm(sourceLang.toUpperCase()),
      );
      if (!confirmed) return;
    }
    const nextSels = { ...selectionsRef.current };
    nextSels[activeLanguageRef.current] = [...sourceSelections];
    onSelectionsChange(nextSels);
  };

  /* ---- Annotation editing ---- */

  const handleAnnotationSave = useCallback(
    (annotations: AnnotationShape[]) => {
      if (!editingItem) return;
      updatePoolAsset(editingItem.id, annotations);
      // Keep editor open — update editingItem with new annotations so it stays in sync
      setEditingItem((prev) => prev ? { ...prev, annotations } : prev);
    },
    [editingItem, updatePoolAsset],
  );

  /* ---- Upload / Pick ---- */

  const [pickerType, setPickerType] = useState<'image' | 'video' | 'document' | null>(null);

  const handleUploadClick = (type: 'image' | 'video' | 'document') => {
    setPickerType(type);
  };

  const triggerFileInput = (type: 'image' | 'video' | 'document') => {
    if (type === 'image') {
      imageInputRef.current?.click();
    } else if (type === 'video') {
      videoInputRef.current?.click();
    } else {
      documentInputRef.current?.click();
    }
  };

  const handleLibrarySelect = (asset: ModuleMediaPoolItem) => {
    // Check if the asset is already in our pool
    const existsInPool = poolRef.current.some((p) => p.url === asset.url);
    if (existsInPool) {
      // Just select it for the current language if not already selected
      const existing = poolRef.current.find((p) => p.url === asset.url)!;
      if (mediaSyncRef.current) {
        // Sync ON — already visible
        return;
      }
      const langSels = selectionsRef.current[activeLanguageRef.current] ?? [];
      if (langSels.some((s) => s.assetId === existing.id)) {
        // Already selected
        return;
      }
      const nextSels = { ...selectionsRef.current };
      nextSels[activeLanguageRef.current] = [...langSels, { assetId: existing.id }];
      onSelectionsChange(nextSels);
    } else {
      // Add to pool with a new ID
      const newAsset: ModuleMediaPoolItem = { ...asset, id: generateId() };
      if (mediaSyncRef.current) {
        addToPool(newAsset, []);
      } else {
        addToPool(newAsset, [activeLanguageRef.current]);
      }
    }
  };

  const handleFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
    type: 'image' | 'video' | 'document',
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(type);
    try {
      const storagePath = buildModuleAssetPath(
        courseId,
        moduleId,
        type === 'image' ? 'images' : type === 'video' ? 'videos' : 'documents',
        file,
      );
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);

      const asset: ModuleMediaPoolItem = { id: generateId(), url, type };

      if (mediaSyncRef.current) {
        // Sync ON: add to pool, all languages see it automatically
        addToPool(asset, []);
      } else {
        // Sync OFF: add to pool and select for active language only
        addToPool(asset, [activeLanguageRef.current]);
      }
    } catch (err) {
      console.error('Failed to upload file', err);
      alert(t.admin.moduleDetail.uploadFileError);
    } finally {
      setUploading(null);
    }
  };

  /* ---- Render ---- */

  const pickerAllowedTypes = pickerType ? [pickerType] as ModuleMediaType[] : undefined;

  return (
    <div className="space-y-3">
      {pickerType && typeof window !== 'undefined' && (
        <MediaPicker
          onSelect={handleLibrarySelect}
          onUploadClick={() => triggerFileInput(pickerType)}
          allowedTypes={pickerAllowedTypes}
          onClose={() => setPickerType(null)}
        />
      )}
      {editingItem && typeof window !== 'undefined' && createPortal(
        <ImageAnnotationEditor
          imageUrl={editingItem.url}
          initialAnnotations={editingItem.annotations ?? []}
          onSave={handleAnnotationSave}
          onClose={() => setEditingItem(null)}
        />,
        document.body,
      )}
      {previewItem && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8"
          onClick={() => setPreviewItem(null)}
        >
          <div className="relative flex items-center justify-center" style={{ width: '85vw', height: '85vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="relative w-full h-full">
              <AnnotatedImage
                src={previewItem.url}
                alt=""
                annotations={previewItem.annotations}
                className="h-full w-full"
              />
            </div>
            <button
              type="button"
              onClick={() => setPreviewItem(null)}
              className="absolute -top-3 -right-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
        </div>,
        document.body,
      )}
      {/* Hidden file input for replace */}
      <input
        ref={replaceFileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleReplaceUpload(file);
          e.target.value = '';
        }}
      />
      {/* Replace broken image modal */}
      {replaceItem && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!replaceUploading) setReplaceItem(null); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                {t.admin.brokenMedia.modalTitle}
              </p>
              <p className="text-xs text-slate-500 break-all font-mono bg-slate-50 rounded-lg px-2 py-1.5 mt-1">
                {replaceItem.url}
              </p>
            </div>
            <p className="text-sm text-slate-600">
              {t.admin.brokenMedia.modalBody(
                poolRef.current.filter((p) => p.url === replaceItem.url).length,
              )}
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={replaceUploading}
                onClick={() => replaceFileInputRef.current?.click()}
                className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {replaceUploading ? t.admin.brokenMedia.replacing : t.admin.brokenMedia.uploadButton}
              </button>
              <button
                type="button"
                disabled={replaceUploading}
                onClick={() => setReplaceItem(null)}
                className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <LocaleEditorHeader label={label} activeLanguage={activeLanguage} />
      {pendingSyncDelete && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPendingSyncDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-slate-900">
              {t.admin.moduleDetail.mediaSyncDeleteTitle}
            </p>
            <p className="text-sm text-slate-600">
              {t.admin.moduleDetail.mediaSyncDeleteMessage}
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={confirmSyncDelete}
                className="cursor-pointer rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:border-red-300 hover:bg-red-50 text-left"
              >
                {t.admin.moduleDetail.mediaSyncDeleteConfirm}
              </button>
              <button
                type="button"
                onClick={() => setPendingSyncDelete(null)}
                className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 text-left"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          <p>{t.admin.moduleDetail.noMediaForLanguage}</p>
          {!mediaSync && langsWithMedia.length > 0 && (
            <div className="mt-4 flex justify-center">
              <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white">
                <SelectWithToggleIcon
                  value={effectiveReuseSource}
                  onChange={(e) => setReuseSourceLang(e.target.value)}
                  className="cursor-pointer border-0 bg-transparent px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none"
                >
                  {langsWithMedia.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang.toUpperCase()} ({t.admin.moduleDetail.mediaReuseElements((selections[lang] ?? []).length)})
                    </option>
                  ))}
                </SelectWithToggleIcon>
                <button
                  type="button"
                  onClick={() => handleReuse(false)}
                  disabled={alreadyReused}
                  className="cursor-pointer border-l border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {reuseButtonLabel}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={items.map((item) => item.id)} strategy={() => null}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <SortableMediaCard
                  key={item.id}
                  item={item}
                  onRemove={() => handleRemove(item.id)}
                  onEdit={() => setEditingItem(item)}
                  onOpen={() => {
                    if (item.type === 'image' && item.annotations?.length) {
                      setPreviewItem(item);
                    } else {
                      window.open(item.url, '_blank');
                    }
                  }}
                  onReplace={() => setReplaceItem(item)}
                  onCaptionChange={(caption) => updateCaption(item.id, caption)}
                  isTarget={overId === item.id && activeId !== null && activeId !== item.id}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeItem ? <MediaDragOverlay item={activeItem} /> : null}
          </DragOverlay>
        </DndContext>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleUploadClick('image')}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={uploading === 'image'}
          >
            {uploading === 'image' ? t.common.uploading : t.admin.moduleDetail.uploadImage}
          </button>
          <button
            type="button"
            onClick={() => handleUploadClick('video')}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={uploading === 'video'}
          >
            {uploading === 'video' ? t.common.uploading : t.admin.moduleDetail.uploadVideo}
          </button>
          <button
            type="button"
            onClick={() => handleUploadClick('document')}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={uploading === 'document'}
          >
            {uploading === 'document' ? t.common.uploading : t.admin.moduleDetail.uploadDocument}
          </button>
        </div>
        <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white">
          {items.length > 0 && langsWithMedia.length > 0 && (
            <div
              className={`flex items-stretch overflow-hidden transition-all duration-300 ease-in-out ${
                !mediaSync ? 'max-w-[480px] opacity-100' : 'max-w-0 opacity-0'
              }`}
            >
              <SelectWithToggleIcon
                value={effectiveReuseSource}
                onChange={(e) => setReuseSourceLang(e.target.value)}
                className="cursor-pointer border-0 bg-transparent px-3 py-2 text-sm font-semibold text-slate-700 focus:outline-none whitespace-nowrap"
              >
                {langsWithMedia.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang.toUpperCase()} ({t.admin.moduleDetail.mediaReuseElements((selections[lang] ?? []).length)})
                  </option>
                ))}
              </SelectWithToggleIcon>
              <span className="w-px shrink-0 self-stretch bg-slate-200" />
              <button
                type="button"
                onClick={() => handleReuse(true)}
                disabled={alreadyReused}
                className="cursor-pointer whitespace-nowrap px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {reuseButtonLabel}
              </button>
              <span className="w-px shrink-0 self-stretch bg-slate-200" />
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 px-3 py-2">
            <span className="whitespace-nowrap text-sm font-semibold text-slate-700">
              {mediaSync
                ? t.admin.moduleDetail.mediaSyncLabelOn
                : t.admin.moduleDetail.mediaSyncLabelOff}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={mediaSync}
              onClick={handleSyncToggle}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${
                mediaSync ? 'bg-slate-900' : 'bg-slate-200'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  mediaSync ? 'translate-x-[18px]' : 'translate-x-0.5'
                }`}
              />
            </button>
          </label>
        </div>
      </div>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => handleFileChange(event, 'image')}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => handleFileChange(event, 'video')}
      />
      <input
        ref={documentInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(event) => handleFileChange(event, 'document')}
      />
    </div>
  );
};

export default LocaleMediaEditor;
