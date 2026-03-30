'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import { getFileNameFromUrl, normalizeToPoolModel, normalizeModuleMediaMap } from '@/utils/media';
import type { ModuleMediaPoolItem, ModuleMediaType } from '@/types/course';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** One unique asset (by URL) found across all modules + standalone library uploads. */
interface LibraryAsset extends ModuleMediaPoolItem {
  /** Each module that contains this asset (with its parent courseId). */
  moduleRefs: { moduleId: string; courseId: string }[];
  /** Source: came from a module pool, or is a standalone library upload. */
  source: 'module' | 'library';
  /** Firestore doc ID for library-only assets (companyMedia collection). */
  libraryDocId?: string;
}

type FilterType = 'all' | 'image' | 'video' | 'document';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const sanitizeFileName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'fil';

/** Extract Firebase Storage path from a download URL. Returns null if not a Firebase URL. */
function storagePathFromUrl(url: string): string | null {
  try {
    // https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded_path}?...
    const match = url.match(/\/o\/([^?]+)/);
    if (match) return decodeURIComponent(match[1]);
  } catch { /* ignore */ }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function MediaLibraryPage() {
  const { companyId } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const ml = t.admin.mediaLibrary;

  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<LibraryAsset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<LibraryAsset | null>(null);
  const [replacing, setReplacing] = useState(false);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  /* ---- Load assets ---- */
  const load = useCallback(async () => {
    if (!companyId) { setAssets([]); setLoading(false); return; }
    setLoading(true);
    try {
      const assetMap = new Map<string, LibraryAsset>();

      // 1. Scan all module pools
      const coursesSnap = await getDocs(
        query(collection(db, 'courses'), where('companyId', '==', companyId)),
      );
      for (const courseDoc of coursesSnap.docs) {
        const courseId = courseDoc.id;
        const modulesSnap = await getDocs(collection(db, 'courses', courseId, 'modules'));
        for (const modDoc of modulesSnap.docs) {
          const data = modDoc.data();
          let poolItems: ModuleMediaPoolItem[];
          if (Array.isArray(data.mediaPool)) {
            poolItems = data.mediaPool as ModuleMediaPoolItem[];
          } else {
            const media = normalizeModuleMediaMap(data.media, data.imageUrls, data.videoUrls);
            poolItems = normalizeToPoolModel(media, data.mediaSync).pool;
          }
          for (const item of poolItems) {
            const existing = assetMap.get(item.url);
            if (existing) {
              // Add ref only if this exact module isn't already tracked
              if (!existing.moduleRefs.some((r) => r.moduleId === modDoc.id)) {
                existing.moduleRefs.push({ moduleId: modDoc.id, courseId });
              }
            } else {
              assetMap.set(item.url, { ...item, moduleRefs: [{ moduleId: modDoc.id, courseId }], source: 'module' });
            }
          }
        }
      }

      // 2. Standalone library uploads
      const libSnap = await getDocs(
        query(collection(db, 'companyMedia'), where('companyId', '==', companyId)),
      );
      for (const libDoc of libSnap.docs) {
        const data = libDoc.data() as { url: string; type: ModuleMediaType; id: string };
        if (!assetMap.has(data.url)) {
          assetMap.set(data.url, {
            id: data.id ?? libDoc.id,
            url: data.url,
            type: data.type ?? 'image',
            moduleRefs: [],
            source: 'library',
            libraryDocId: libDoc.id,
          });
        } else {
          // URL exists from a module; mark it also has a library doc
          const existing = assetMap.get(data.url)!;
          existing.libraryDocId = libDoc.id;
        }
      }

      setAssets(Array.from(assetMap.values()));
    } catch (err) {
      console.error('Failed to load media library', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  /* ---- Delete ---- */
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Remove from each module's mediaPool
      for (const { moduleId, courseId } of deleteTarget.moduleRefs) {
        const modRef = doc(db, 'courses', courseId, 'modules', moduleId);
        const modSnap = await getDocs(
          query(collection(db, 'courses', courseId, 'modules')),
        );
        const modDoc = modSnap.docs.find((d) => d.id === moduleId);
        if (!modDoc) continue;
        const data = modDoc.data();

        // Update mediaPool
        const newPool = Array.isArray(data.mediaPool)
          ? (data.mediaPool as ModuleMediaPoolItem[]).filter((p) => p.url !== deleteTarget.url)
          : [];

        // Update legacy media map
        const newMedia: Record<string, unknown[]> = {};
        if (data.media && typeof data.media === 'object') {
          for (const [lang, items] of Object.entries(data.media as Record<string, unknown[]>)) {
            newMedia[lang] = (items as { url?: string }[]).filter((i) => i.url !== deleteTarget.url);
          }
        }

        // Update mediaSelections — remove selections referencing removed assets
        const removedIds = Array.isArray(data.mediaPool)
          ? (data.mediaPool as ModuleMediaPoolItem[])
              .filter((p) => p.url === deleteTarget.url)
              .map((p) => p.id)
          : [];
        const newSelections: Record<string, unknown[]> = {};
        if (data.mediaSelections && typeof data.mediaSelections === 'object') {
          for (const [lang, sels] of Object.entries(data.mediaSelections as Record<string, { assetId: string }[]>)) {
            newSelections[lang] = sels.filter((s) => !removedIds.includes(s.assetId));
          }
        }

        await updateDoc(modRef, {
          mediaPool: newPool,
          ...(Object.keys(newMedia).length ? { media: newMedia } : {}),
          ...(Object.keys(newSelections).length ? { mediaSelections: newSelections } : {}),
        });
      }

      // Delete standalone library doc if present
      if (deleteTarget.libraryDocId) {
        await deleteDoc(doc(db, 'companyMedia', deleteTarget.libraryDocId));
      }

      // Try to delete from Firebase Storage
      const storagePath = storagePathFromUrl(deleteTarget.url);
      if (storagePath) {
        try {
          await deleteObject(ref(storage, storagePath));
        } catch { /* file may already be gone */ }
      }

      setDeleteTarget(null);
      await load();
    } catch (err) {
      console.error('Delete failed', err);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, load]);

  /* ---- Upload ---- */
  const handleUpload = useCallback(async (file: File) => {
    if (!companyId) return;
    setUploading(true);
    try {
      const path = `companies/${companyId}/media/${Date.now()}-${sanitizeFileName(file.name)}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      const type: ModuleMediaType =
        file.type.startsWith('video/') ? 'video' :
        file.type === 'application/pdf' || file.type.includes('document') ? 'document' : 'image';
      const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
      await setDoc(doc(db, 'companyMedia', id), { id, companyId, url, type, createdAt: Date.now() });
      await load();
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setUploading(false);
    }
  }, [companyId, load]);

  /* ---- Replace broken URL ---- */
  const handleReplace = useCallback(async (file: File) => {
    if (!replaceTarget || !companyId) return;
    setReplacing(true);
    try {
      // Upload new file
      const path = `companies/${companyId}/media/${Date.now()}-${sanitizeFileName(file.name)}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const newUrl = await getDownloadURL(storageRef);

      // Swap URL in every affected module
      for (const { moduleId, courseId } of replaceTarget.moduleRefs) {
        const modRef = doc(db, 'courses', courseId, 'modules', moduleId);
        const modulesSnap = await getDocs(collection(db, 'courses', courseId, 'modules'));
        const modDoc = modulesSnap.docs.find((d) => d.id === moduleId);
        if (!modDoc) continue;
        const data = modDoc.data();

        const swapUrl = (url: string) => (url === replaceTarget.url ? newUrl : url);

        const newPool = Array.isArray(data.mediaPool)
          ? (data.mediaPool as { url: string }[]).map((p) => ({ ...p, url: swapUrl(p.url) }))
          : [];

        const newMedia: Record<string, unknown[]> = {};
        if (data.media && typeof data.media === 'object') {
          for (const [lang, items] of Object.entries(data.media as Record<string, { url?: string }[]>)) {
            newMedia[lang] = items.map((i) => i.url ? { ...i, url: swapUrl(i.url) } : i);
          }
        }

        await updateDoc(modRef, {
          mediaPool: newPool,
          ...(Object.keys(newMedia).length ? { media: newMedia } : {}),
        });
      }

      // Update companyMedia doc if present
      if (replaceTarget.libraryDocId) {
        await updateDoc(doc(db, 'companyMedia', replaceTarget.libraryDocId), { url: newUrl });
      }

      // Try to delete old file from storage
      const oldPath = storagePathFromUrl(replaceTarget.url);
      if (oldPath) {
        try { await deleteObject(ref(storage, oldPath)); } catch { /* already gone */ }
      }

      setReplaceTarget(null);
      await load();
    } catch (err) {
      console.error('Replace failed', err);
    } finally {
      setReplacing(false);
    }
  }, [replaceTarget, companyId, load]);

  /* ---- Filtered list ---- */
  const filtered = useMemo(() => {
    let result = assets;
    if (filter !== 'all') result = result.filter((a) => a.type === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((a) => getFileNameFromUrl(a.url).toLowerCase().includes(q));
    }
    return result;
  }, [assets, filter, search]);

  const filterButtons: { key: FilterType; label: string }[] = [
    { key: 'all', label: ml.filterAll },
    { key: 'image', label: ml.filterImages },
    { key: 'video', label: ml.filterVideos },
    { key: 'document', label: ml.filterDocuments },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* Hidden replace input */}
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleReplace(file);
          e.target.value = '';
        }}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{ml.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{ml.subtitle}</p>
        </div>
        <div>
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/*,video/*,.pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleUpload(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => uploadInputRef.current?.click()}
            className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? ml.uploading : ml.addMedia}
          </button>
        </div>
      </div>

      {/* Filters + Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
          {filterButtons.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                filter === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={ml.searchPlaceholder}
          className="w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm font-semibold text-slate-500">{t.common.loading}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-16 text-center">
          <p className="text-sm text-slate-500">
            {assets.length === 0 ? ml.emptyLibrary : ml.noResults}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((asset) => (
            <MediaCard
              key={asset.url}
              asset={asset}
              onDelete={() => setDeleteTarget(asset)}
              onReplace={() => { setReplaceTarget(asset); }}
            />
          ))}
        </div>
      )}

      {/* Replace broken image modal */}
      {replaceTarget && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!replacing) setReplaceTarget(null); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">{t.admin.brokenMedia.modalTitle}</p>
              <p className="text-xs text-slate-500 break-all font-mono bg-slate-50 rounded-lg px-2 py-1.5 mt-1">
                {getFileNameFromUrl(replaceTarget.url)}
              </p>
            </div>
            <p className="text-sm text-slate-600">
              {t.admin.brokenMedia.modalBody(replaceTarget.moduleRefs.length)}
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={replacing}
                onClick={() => replaceInputRef.current?.click()}
                className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {replacing ? t.admin.brokenMedia.replacing : t.admin.brokenMedia.uploadButton}
              </button>
              <button
                type="button"
                disabled={replacing}
                onClick={() => setReplaceTarget(null)}
                className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && typeof window !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!deleting) setDeleteTarget(null); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-slate-900">{ml.deleteConfirmTitle}</p>
            <p className="text-xs text-slate-500 break-all font-mono bg-slate-50 rounded-lg px-2 py-1.5">
              {getFileNameFromUrl(deleteTarget.url)}
            </p>
            <p className="text-sm text-slate-600">
              {ml.deleteConfirmMessage(deleteTarget.moduleRefs.length)}
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="cursor-pointer rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting ? ml.deleting : ml.deleteConfirmButton}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MediaCard                                                          */
/* ------------------------------------------------------------------ */

function MediaCard({ asset, onDelete, onReplace }: {
  asset: LibraryAsset;
  onDelete: () => void;
  onReplace: () => void;
}) {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const ml = t.admin.mediaLibrary;
  const fileName = getFileNameFromUrl(asset.url);

  // Use a raw Image probe (not Next.js <Image>) so we catch URLs that are 404
  // on the origin even if Next.js has a cached optimised version in memory.
  const [imgError, setImgError] = useState(false);
  useEffect(() => {
    setImgError(false);
    if (asset.type !== 'image') return;
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => { /* reachable */ };
    probe.onerror = () => { if (!cancelled) setImgError(true); };
    probe.src = asset.url;
    return () => { cancelled = true; probe.src = ''; };
  }, [asset.url, asset.type]);

  const handleOpenFile = () => {
    if (imgError) { onReplace(); return; }
    window.open(asset.url, '_blank');
  };

  const typeLabel =
    asset.type === 'video' ? ml.filterVideos :
    asset.type === 'document' ? ml.filterDocuments : ml.filterImages;

  return (
    <div className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      {/* Thumbnail */}
      <div className="relative h-36 w-full bg-slate-100">
        {asset.type === 'image' ? (
          imgError ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-slate-400">
              <span className="text-3xl">🖼️</span>
              <span className="text-[10px] font-semibold text-amber-600">URL broken</span>
            </div>
          ) : (
            <Image
              fill
              src={asset.url}
              alt={fileName}
              className="object-contain"
              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, 25vw"
              onError={() => setImgError(true)}
            />
          )
        ) : asset.type === 'video' ? (
          <div className="flex h-full w-full items-center justify-center text-4xl text-slate-400">🎥</div>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-4xl text-slate-400">📄</div>
        )}
      </div>

      {/* Info */}
      <div className="space-y-2 p-3">
        <p className="truncate text-xs font-semibold text-slate-700" title={fileName}>
          {fileName}
        </p>
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {typeLabel}
          </span>
          <span className="text-[10px] text-slate-400">
            {ml.usedInModules(asset.moduleRefs.length)}
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-1.5 pt-0.5">
          {imgError && asset.type === 'image' ? (
            <button
              type="button"
              onClick={onReplace}
              className="flex-1 cursor-pointer rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-700 hover:border-amber-400 hover:bg-amber-100"
            >
              {t.admin.brokenMedia.replaceButton}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenFile}
              className="flex-1 cursor-pointer rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              {ml.openFile}
            </button>
          )}
          <button
            type="button"
            onClick={onDelete}
            className="cursor-pointer rounded-lg border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50"
          >
            {ml.deleteButton}
          </button>
        </div>
      </div>
    </div>
  );
}
