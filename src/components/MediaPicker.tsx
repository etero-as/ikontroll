'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import { getFileNameFromUrl, normalizeToPoolModel, normalizeModuleMediaMap } from '@/utils/media';
import type { ModuleMediaPoolItem, ModuleMediaType } from '@/types/course';

export interface MediaPickerProps {
  /** Called when user selects an existing library asset. */
  onSelect: (asset: ModuleMediaPoolItem) => void;
  /** Called when user wants to upload from PC — the parent handles the actual file input. */
  onUploadClick: () => void;
  /** Filter to specific media types. */
  allowedTypes?: ModuleMediaType[];
  /** Close the picker. */
  onClose: () => void;
}

export default function MediaPicker({
  onSelect,
  onUploadClick,
  allowedTypes,
  onClose,
}: MediaPickerProps) {
  const { companyId } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);

  const [assets, setAssets] = useState<ModuleMediaPoolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<'choose' | null>(null);

  // Load library assets
  useEffect(() => {
    if (!companyId || mode !== 'choose') {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const coursesSnap = await getDocs(
          query(collection(db, 'courses'), where('companyId', '==', companyId)),
        );

        const assetMap = new Map<string, ModuleMediaPoolItem>();
        for (const courseDoc of coursesSnap.docs) {
          const modulesSnap = await getDocs(
            collection(db, 'courses', courseDoc.id, 'modules'),
          );
          for (const modDoc of modulesSnap.docs) {
            const data = modDoc.data();
            let poolItems: ModuleMediaPoolItem[];
            if (Array.isArray(data.mediaPool)) {
              poolItems = data.mediaPool as ModuleMediaPoolItem[];
            } else {
              const media = normalizeModuleMediaMap(data.media, data.imageUrls, data.videoUrls);
              const migrated = normalizeToPoolModel(media, data.mediaSync);
              poolItems = migrated.pool;
            }
            for (const item of poolItems) {
              if (!assetMap.has(item.url)) {
                assetMap.set(item.url, item);
              }
            }
          }
        }

        if (!cancelled) {
          let result = Array.from(assetMap.values());
          if (allowedTypes?.length) {
            result = result.filter((a) => allowedTypes.includes(a.type));
          }
          // Filter out images with broken URLs so the library only shows accessible assets
          const probeResults = await Promise.all(
            result.map(
              (a) =>
                a.type !== 'image'
                  ? Promise.resolve(true)
                  : new Promise<boolean>((resolve) => {
                      const img = new window.Image();
                      img.onload = () => resolve(true);
                      img.onerror = () => resolve(false);
                      img.src = a.url;
                    }),
            ),
          );
          result = result.filter((_, i) => probeResults[i]);
          setAssets(result);
        }
      } catch (err) {
        console.error('Failed to load media library', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [companyId, mode, allowedTypes]);

  type FilterType = 'all' | 'image' | 'video' | 'document';
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');

  const filtered = useMemo(() => {
    let result = assets;
    if (typeFilter !== 'all') {
      result = result.filter((a) => a.type === typeFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((a) => getFileNameFromUrl(a.url).toLowerCase().includes(q));
    }
    return result;
  }, [assets, search, typeFilter]);

  // Initial choice screen
  if (mode === null) {
    return createPortal(
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-sm font-semibold text-slate-900">
            {t.admin.mediaPicker.title}
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onUploadClick();
              }}
              className="cursor-pointer rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 text-left"
            >
              {t.admin.mediaPicker.uploadFromPc}
            </button>
            <button
              type="button"
              onClick={() => setMode('choose')}
              className="cursor-pointer rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 text-left"
            >
              {t.admin.mediaPicker.chooseFromLibrary}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
          >
            {t.common.cancel}
          </button>
        </div>
      </div>,
      document.body,
    );
  }

  // Library browse screen
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">
            {t.admin.mediaPicker.chooseFromLibrary}
          </p>
          <button
            type="button"
            onClick={() => setMode(null)}
            className="cursor-pointer text-xs font-semibold text-slate-500 hover:text-slate-700"
          >
            &larr;
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
            {([
              { key: 'all' as FilterType, label: t.admin.mediaLibrary.filterAll },
              { key: 'image' as FilterType, label: t.admin.mediaLibrary.filterImages },
              { key: 'video' as FilterType, label: t.admin.mediaLibrary.filterVideos },
              { key: 'document' as FilterType, label: t.admin.mediaLibrary.filterDocuments },
            ]).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTypeFilter(key)}
                className={`cursor-pointer rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  typeFilter === key
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
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
            placeholder={t.admin.mediaPicker.searchPlaceholder}
            className="flex-1 min-w-[140px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-slate-500">...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-500">
              {t.admin.mediaPicker.noMediaAvailable}
            </p>
          </div>
        ) : (
          <div className="grid max-h-96 gap-3 overflow-y-auto sm:grid-cols-3">
            {filtered.map((asset) => {
              const fileName = getFileNameFromUrl(asset.url);
              return (
                <button
                  key={asset.url}
                  type="button"
                  onClick={() => {
                    onSelect(asset);
                    onClose();
                  }}
                  className="cursor-pointer group overflow-hidden rounded-xl border border-slate-200 bg-white text-left transition hover:border-slate-400 hover:shadow-md"
                >
                  <div className="relative h-24 w-full bg-slate-100">
                    {asset.type === 'image' ? (
                      <Image
                        fill
                        src={asset.url}
                        alt={fileName}
                        className="object-contain"
                        sizes="200px"
                      />
                    ) : asset.type === 'video' ? (
                      <div className="flex h-full w-full items-center justify-center text-2xl text-slate-400">
                        🎥
                      </div>
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl text-slate-400">
                        📄
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-xs font-medium text-slate-700" title={fileName}>
                      {fileName}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
        >
          {t.common.cancel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
