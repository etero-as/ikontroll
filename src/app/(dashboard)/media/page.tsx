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
import { ChevronRight, FolderIcon, FolderPlus, ImageIcon, FileText, Film, Upload, Search, LayoutList, LayoutGrid } from 'lucide-react';

import { db, storage } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import { getFileNameFromUrl, normalizeToPoolModel, normalizeModuleMediaMap } from '@/utils/media';
import type { ModuleMediaPoolItem, ModuleMediaType } from '@/types/course';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LibraryAsset extends ModuleMediaPoolItem {
  moduleRefs: { moduleId: string; courseId: string }[];
  source: 'module' | 'library';
  libraryDocId?: string;
  folderId?: string | null;
  displayName?: string;
  createdAt?: number;
  fileSize?: number;
}

interface FolderItem {
  id: string;
  name: string;
  parentFolderId: string | null;
  companyId: string;
  createdAt: number;
  type: 'folder';
}

type ListItem =
  | (FolderItem & { _kind: 'folder' })
  | (LibraryAsset & { _kind: 'asset' });

type FilterType = 'all' | 'image' | 'video' | 'document';
type ViewMode = 'list' | 'grid';

interface ContextMenuState {
  x: number;
  y: number;
  item: ListItem | null;
}

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

function storagePathFromUrl(url: string): string | null {
  try {
    const match = url.match(/\/o\/([^?]+)/);
    if (match) return decodeURIComponent(match[1]);
  } catch { /* ignore */ }
  return null;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getItemName(item: ListItem): string {
  if (item._kind === 'folder') return item.name;
  return (item as LibraryAsset).displayName || getFileNameFromUrl((item as LibraryAsset).url);
}

function getTypeIcon(type: ModuleMediaType | 'folder') {
  switch (type) {
    case 'folder': return <FolderIcon size={18} className="text-amber-500" />;
    case 'image': return <ImageIcon size={18} className="text-blue-500" />;
    case 'video': return <Film size={18} className="text-purple-500" />;
    case 'document': return <FileText size={18} className="text-red-500" />;
    default: return <FileText size={18} className="text-slate-400" />;
  }
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
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [search, setSearch] = useState('');
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<LibraryAsset | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [cutIds, setCutIds] = useState<Set<string>>(new Set());
  const [mediaPreview, setMediaPreview] = useState<LibraryAsset | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [draggingIds, setDraggingIds] = useState<Set<string>>(new Set());

  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  /* ---- Load assets + folders ---- */
  const load = useCallback(async () => {
    if (!companyId) { setAssets([]); setFolders([]); setLoading(false); return; }
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
      const loadedFolders: FolderItem[] = [];
      for (const libDoc of libSnap.docs) {
        const data = libDoc.data();
        if (data.type === 'folder') {
          loadedFolders.push({
            id: libDoc.id,
            name: data.name ?? ml.untitledFolder,
            parentFolderId: data.parentFolderId ?? null,
            companyId: data.companyId,
            createdAt: data.createdAt ?? 0,
            type: 'folder',
          });
          continue;
        }
        const assetData = data as { url: string; type: ModuleMediaType; id: string; folderId?: string; displayName?: string; createdAt?: number; fileSize?: number };
        if (!assetMap.has(assetData.url)) {
          assetMap.set(assetData.url, {
            id: assetData.id ?? libDoc.id,
            url: assetData.url,
            type: assetData.type ?? 'image',
            moduleRefs: [],
            source: 'library',
            libraryDocId: libDoc.id,
            folderId: assetData.folderId ?? null,
            displayName: assetData.displayName,
            createdAt: assetData.createdAt,
            fileSize: assetData.fileSize,
          });
        } else {
          const existing = assetMap.get(assetData.url)!;
          existing.libraryDocId = libDoc.id;
          if (assetData.folderId) existing.folderId = assetData.folderId;
          if (assetData.displayName) existing.displayName = assetData.displayName;
          if (assetData.createdAt) existing.createdAt = assetData.createdAt;
          if (assetData.fileSize) existing.fileSize = assetData.fileSize;
        }
      }

      setAssets(Array.from(assetMap.values()));
      setFolders(loadedFolders);
    } catch (err) {
      console.error('Failed to load media library', err);
    } finally {
      setLoading(false);
    }
  }, [companyId, ml.untitledFolder]);

  useEffect(() => { void load(); }, [load]);

  /* ---- Breadcrumb path ---- */
  const breadcrumbPath = useMemo(() => {
    const path: FolderItem[] = [];
    let fId = currentFolderId;
    while (fId) {
      const folder = folders.find((f) => f.id === fId);
      if (!folder) break;
      path.unshift(folder);
      fId = folder.parentFolderId;
    }
    return path;
  }, [currentFolderId, folders]);

  /* ---- Filtered + scoped list ---- */
  const listItems = useMemo(() => {
    const items: ListItem[] = [];

    // Folders in current directory
    const currentFolders = folders
      .filter((f) => f.parentFolderId === currentFolderId)
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const f of currentFolders) {
      items.push({ ...f, _kind: 'folder' });
    }

    // Assets in current directory
    let currentAssets = assets.filter((a) => (a.folderId ?? null) === currentFolderId);
    if (filter !== 'all') currentAssets = currentAssets.filter((a) => a.type === filter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      currentAssets = currentAssets.filter((a) => getItemName({ ...a, _kind: 'asset' }).toLowerCase().includes(q));
    }
    for (const a of currentAssets) {
      items.push({ ...a, _kind: 'asset' });
    }

    return items;
  }, [assets, folders, currentFolderId, filter, search]);

  /* ---- Delete ---- */
  const handleDeleteAsset = useCallback(async (asset: LibraryAsset) => {
    setDeleting(true);
    try {
      for (const { moduleId, courseId } of asset.moduleRefs) {
        const modRef = doc(db, 'courses', courseId, 'modules', moduleId);
        const modSnap = await getDocs(query(collection(db, 'courses', courseId, 'modules')));
        const modDoc = modSnap.docs.find((d) => d.id === moduleId);
        if (!modDoc) continue;
        const data = modDoc.data();

        const newPool = Array.isArray(data.mediaPool)
          ? (data.mediaPool as ModuleMediaPoolItem[]).filter((p) => p.url !== asset.url)
          : [];

        const newMedia: Record<string, unknown[]> = {};
        if (data.media && typeof data.media === 'object') {
          for (const [lang, items] of Object.entries(data.media as Record<string, unknown[]>)) {
            newMedia[lang] = (items as { url?: string }[]).filter((i) => i.url !== asset.url);
          }
        }

        const removedIds = Array.isArray(data.mediaPool)
          ? (data.mediaPool as ModuleMediaPoolItem[]).filter((p) => p.url === asset.url).map((p) => p.id)
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

      if (asset.libraryDocId) {
        await deleteDoc(doc(db, 'companyMedia', asset.libraryDocId));
      }

      const storagePath = storagePathFromUrl(asset.url);
      if (storagePath) {
        try { await deleteObject(ref(storage, storagePath)); } catch { /* already gone */ }
      }
    } catch (err) {
      console.error('Delete failed', err);
    }
  }, []);

  const handleDeleteFolder = useCallback(async (folder: FolderItem) => {
    setDeleting(true);
    try {
      // Recursively collect all descendant folder IDs
      const allFolderIds = new Set<string>();
      const collectDescendants = (parentId: string) => {
        allFolderIds.add(parentId);
        for (const f of folders) {
          if (f.parentFolderId === parentId) collectDescendants(f.id);
        }
      };
      collectDescendants(folder.id);

      // Delete all assets in these folders
      for (const asset of assets) {
        if (asset.folderId && allFolderIds.has(asset.folderId)) {
          await handleDeleteAsset(asset);
        }
      }

      // Delete all folder docs
      for (const fId of allFolderIds) {
        await deleteDoc(doc(db, 'companyMedia', fId));
      }
    } catch (err) {
      console.error('Delete folder failed', err);
    }
  }, [folders, assets, handleDeleteAsset]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget._kind === 'folder') {
        await handleDeleteFolder(deleteTarget);
      } else {
        await handleDeleteAsset(deleteTarget);
      }
      setDeleteTarget(null);
      await load();
    } catch (err) {
      console.error('Delete failed', err);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, handleDeleteAsset, handleDeleteFolder, load]);

  /* ---- Upload ---- */
  const handleUpload = useCallback(async (file: File, targetFolderId?: string | null) => {
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
      await setDoc(doc(db, 'companyMedia', id), {
        id, companyId, url, type, createdAt: Date.now(),
        folderId: (targetFolderId !== undefined ? targetFolderId : currentFolderId) ?? null,
        displayName: file.name,
        fileSize: file.size,
      });
      await load();
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setUploading(false);
    }
  }, [companyId, currentFolderId, load]);

  /* ---- Replace broken URL ---- */
  const handleReplace = useCallback(async (file: File) => {
    if (!replaceTarget || !companyId) return;
    setReplacing(true);
    try {
      const path = `companies/${companyId}/media/${Date.now()}-${sanitizeFileName(file.name)}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);
      const newUrl = await getDownloadURL(storageRef);

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

      if (replaceTarget.libraryDocId) {
        await updateDoc(doc(db, 'companyMedia', replaceTarget.libraryDocId), { url: newUrl });
      }

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

  /* ---- Move asset to folder (creates companyMedia doc if needed) ---- */
  const moveAssetToFolder = useCallback(async (assetId: string, targetFolderId: string | null) => {
    const asset = assets.find((a) => a.id === assetId || a.libraryDocId === assetId);
    if (!asset) return;
    if (asset.libraryDocId) {
      await updateDoc(doc(db, 'companyMedia', asset.libraryDocId), { folderId: targetFolderId });
    } else if (companyId) {
      // Module-only asset — create a companyMedia doc so it can be placed in a folder
      const newId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
      await setDoc(doc(db, 'companyMedia', newId), {
        id: newId, companyId, url: asset.url, type: asset.type,
        createdAt: Date.now(), folderId: targetFolderId,
        displayName: getFileNameFromUrl(asset.url),
      });
    }
  }, [assets, companyId]);

  /* ---- New folder ---- */
  const handleNewFolder = useCallback(async () => {
    if (!companyId) return;
    const id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    await setDoc(doc(db, 'companyMedia', id), {
      id, companyId, type: 'folder', name: ml.untitledFolder,
      parentFolderId: currentFolderId ?? null, createdAt: Date.now(),
    });
    await load();
    setRenamingId(id);
    setRenameValue(ml.untitledFolder);
  }, [companyId, currentFolderId, load, ml.untitledFolder]);

  /* ---- Rename ---- */
  const handleRenameSubmit = useCallback(async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; }
    try {
      const folder = folders.find((f) => f.id === renamingId);
      if (folder) {
        await updateDoc(doc(db, 'companyMedia', renamingId), { name: renameValue.trim() });
      } else {
        const asset = assets.find((a) => a.id === renamingId || a.libraryDocId === renamingId);
        if (asset?.libraryDocId) {
          await updateDoc(doc(db, 'companyMedia', asset.libraryDocId), { displayName: renameValue.trim() });
        }
      }
      await load();
    } catch (err) {
      console.error('Rename failed', err);
    }
    setRenamingId(null);
  }, [renamingId, renameValue, folders, assets, load]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  /* ---- Move (cut/paste) ---- */
  const handlePaste = useCallback(async () => {
    if (cutIds.size === 0) return;
    try {
      for (const id of cutIds) {
        const folder = folders.find((f) => f.id === id);
        if (folder) {
          await updateDoc(doc(db, 'companyMedia', id), { parentFolderId: currentFolderId ?? null });
        } else {
          await moveAssetToFolder(id, currentFolderId ?? null);
        }
      }
      setCutIds(new Set());
      await load();
    } catch (err) {
      console.error('Move failed', err);
    }
  }, [cutIds, currentFolderId, folders, moveAssetToFolder, load]);

  /* ---- Drag and drop ---- */
  const handleDragStart = useCallback((e: React.DragEvent, item: ListItem) => {
    const itemId = item._kind === 'folder' ? item.id : (item.libraryDocId ?? item.id);
    e.dataTransfer.setData('text/plain', itemId);
    e.dataTransfer.effectAllowed = 'move';
    const ids = selectedIds.has(itemId) ? new Set(selectedIds) : new Set([itemId]);
    setSelectedIds(ids);
    setDraggingIds(ids);
  }, [selectedIds]);

  const handleDragOver = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(targetId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    setDragOverId(null);
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === targetFolderId) return;

    const idsToMove = selectedIds.has(draggedId) ? selectedIds : new Set([draggedId]);

    try {
      for (const id of idsToMove) {
        if (id === targetFolderId) continue;
        const folder = folders.find((f) => f.id === id);
        if (folder) {
          // Don't allow dropping a folder into its own descendant
          let check: string | null = targetFolderId;
          let isDescendant = false;
          while (check) {
            if (check === id) { isDescendant = true; break; }
            const parent = folders.find((f) => f.id === check);
            check = parent?.parentFolderId ?? null;
          }
          if (!isDescendant) {
            await updateDoc(doc(db, 'companyMedia', id), { parentFolderId: targetFolderId });
          }
        } else {
          await moveAssetToFolder(id, targetFolderId);
        }
      }
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      console.error('Drop move failed', err);
    }
  }, [selectedIds, folders, moveAssetToFolder, load]);

  const handleDropOnBreadcrumb = useCallback(async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault();
    setDragOverId(null);
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId) return;

    const idsToMove = selectedIds.has(draggedId) ? selectedIds : new Set([draggedId]);

    try {
      for (const id of idsToMove) {
        const folder = folders.find((f) => f.id === id);
        if (folder) {
          await updateDoc(doc(db, 'companyMedia', id), { parentFolderId: targetFolderId });
        } else {
          await moveAssetToFolder(id, targetFolderId);
        }
      }
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      console.error('Breadcrumb drop failed', err);
    }
  }, [selectedIds, folders, assets, load]);

  /* ---- Selection ---- */
  const handleRowClick = useCallback((e: React.MouseEvent, item: ListItem, index: number) => {
    const itemId = item._kind === 'folder' ? item.id : (item.libraryDocId ?? item.id);
    setFocusedIndex(index);

    if (e.ctrlKey || e.metaKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
        return next;
      });
    } else if (e.shiftKey && focusedIndex >= 0) {
      const start = Math.min(focusedIndex, index);
      const end = Math.max(focusedIndex, index);
      const ids = new Set<string>();
      for (let i = start; i <= end; i++) {
        const it = listItems[i];
        ids.add(it._kind === 'folder' ? it.id : ((it as LibraryAsset).libraryDocId ?? it.id));
      }
      setSelectedIds(ids);
    } else {
      setSelectedIds(new Set([itemId]));
    }
  }, [focusedIndex, listItems]);

  const handleRowDoubleClick = useCallback((item: ListItem) => {
    if (item._kind === 'folder') {
      setCurrentFolderId(item.id);
      setSelectedIds(new Set());
      setFocusedIndex(-1);
    } else {
      setMediaPreview(item as LibraryAsset);
    }
  }, []);

  /* ---- Context menu ---- */
  const handleContextMenu = useCallback((e: React.MouseEvent, item: ListItem, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    const itemId = item._kind === 'folder' ? item.id : (item.libraryDocId ?? item.id);
    if (!selectedIds.has(itemId)) {
      setSelectedIds(new Set([itemId]));
      setFocusedIndex(index);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, [selectedIds]);

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item: null });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        closeContextMenu();
      }
    };
    const handleScroll = () => closeContextMenu();
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [contextMenu, closeContextMenu]);

  /* ---- Keyboard ---- */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't handle when renaming
    if (renamingId) return;
    // Don't handle when typing in search
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    const focusedItem = focusedIndex >= 0 && focusedIndex < listItems.length ? listItems[focusedIndex] : null;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const next = Math.min(focusedIndex + 1, listItems.length - 1);
        setFocusedIndex(next);
        const it = listItems[next];
        if (it) setSelectedIds(new Set([it._kind === 'folder' ? it.id : ((it as LibraryAsset).libraryDocId ?? it.id)]));
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prev = Math.max(focusedIndex - 1, 0);
        setFocusedIndex(prev);
        const it = listItems[prev];
        if (it) setSelectedIds(new Set([it._kind === 'folder' ? it.id : ((it as LibraryAsset).libraryDocId ?? it.id)]));
        break;
      }
      case 'Enter': {
        e.preventDefault();
        if (focusedItem) handleRowDoubleClick(focusedItem);
        break;
      }
      case 'Delete':
      case 'Backspace': {
        if (focusedItem) {
          e.preventDefault();
          setDeleteTarget(focusedItem);
        }
        break;
      }
      case 'Escape': {
        setContextMenu(null);
        setSelectedIds(new Set());
        setFocusedIndex(-1);
        break;
      }
      case 'F2': {
        e.preventDefault();
        if (focusedItem) {
          const id = focusedItem._kind === 'folder' ? focusedItem.id : ((focusedItem as LibraryAsset).libraryDocId ?? focusedItem.id);
          setRenamingId(id);
          setRenameValue(getItemName(focusedItem));
        }
        break;
      }
      case 'c': {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (focusedItem && focusedItem._kind === 'asset') {
            void navigator.clipboard.writeText((focusedItem as LibraryAsset).url);
          }
        }
        break;
      }
      case 'x': {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          setCutIds(new Set(selectedIds));
        }
        break;
      }
      case 'v': {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          if (cutIds.size > 0) {
            void handlePaste();
          } else {
            // Try clipboard file paste
            void navigator.clipboard.read?.().then((items) => {
              for (const item of items) {
                for (const type of item.types) {
                  if (type.startsWith('image/') || type === 'application/pdf') {
                    void item.getType(type).then((blob) => {
                      const file = new File([blob], `pasted-${Date.now()}.${type.split('/')[1]}`, { type });
                      void handleUpload(file);
                    });
                    return;
                  }
                }
              }
            }).catch(() => { /* clipboard not available */ });
          }
        }
        break;
      }
      case 'a': {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const allIds = new Set(listItems.map((it) => it._kind === 'folder' ? it.id : ((it as LibraryAsset).libraryDocId ?? it.id)));
          setSelectedIds(allIds);
        }
        break;
      }
    }
  }, [focusedIndex, listItems, renamingId, handleRowDoubleClick, selectedIds, cutIds, handlePaste, handleUpload]);

  /* ---- Filter buttons ---- */
  const filterButtons: { key: FilterType; label: string }[] = [
    { key: 'all', label: ml.filterAll },
    { key: 'image', label: ml.filterImages },
    { key: 'video', label: ml.filterVideos },
    { key: 'document', label: ml.filterDocuments },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-4"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
      onDrop={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}>
      {/* Hidden inputs */}
      <input ref={replaceInputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleReplace(f); e.target.value = ''; }} />
      <input ref={uploadInputRef} type="file" accept="image/*,video/*,.pdf,.doc,.docx" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f); e.target.value = ''; }} />

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{ml.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{ml.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void handleNewFolder()}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <FolderPlus size={16} />
            {ml.newFolder}
          </button>
          <button type="button" disabled={uploading} onClick={() => uploadInputRef.current?.click()}
            className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
            <Upload size={16} />
            {uploading ? ml.uploading : ml.addMedia}
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-sm text-slate-500">
        <button type="button" onClick={() => { setCurrentFolderId(null); setSelectedIds(new Set()); setFocusedIndex(-1); }}
          onDragEnter={(e) => e.preventDefault()}
          onDragOver={(e) => { e.preventDefault(); setDragOverId('__root__'); }}
          onDragLeave={handleDragLeave}
          onDrop={(e) => void handleDropOnBreadcrumb(e, null)}
          className={`cursor-pointer rounded-lg px-2 py-1 font-medium hover:bg-slate-100 ${dragOverId === '__root__' ? 'bg-blue-100 ring-2 ring-blue-300' : ''} ${currentFolderId === null ? 'text-slate-900' : ''}`}>
          {ml.home}
        </button>
        {breadcrumbPath.map((folder) => (
          <span key={folder.id} className="flex items-center gap-1">
            <ChevronRight size={14} />
            <button type="button" onClick={() => { setCurrentFolderId(folder.id); setSelectedIds(new Set()); setFocusedIndex(-1); }}
              onDragEnter={(e) => e.preventDefault()}
              onDragOver={(e) => { e.preventDefault(); setDragOverId(`bc-${folder.id}`); }}
              onDragLeave={handleDragLeave}
              onDrop={(e) => void handleDropOnBreadcrumb(e, folder.id)}
              className={`cursor-pointer rounded-lg px-2 py-1 font-medium hover:bg-slate-100 ${dragOverId === `bc-${folder.id}` ? 'bg-blue-100 ring-2 ring-blue-300' : ''} ${folder.id === currentFolderId ? 'text-slate-900' : ''}`}>
              {folder.name}
            </button>
          </span>
        ))}
      </nav>

      {/* Filters + Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
          {filterButtons.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setFilter(key)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                filter === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={ml.searchPlaceholder}
            className="w-64 rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200" />
        </div>
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
          <button type="button" onClick={() => setViewMode('list')}
            title={ml.viewList}
            className={`cursor-pointer rounded-lg p-1.5 transition ${
              viewMode === 'list' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
            }`}>
            <LayoutList size={16} />
          </button>
          <button type="button" onClick={() => setViewMode('grid')}
            title={ml.viewGrid}
            className={`cursor-pointer rounded-lg p-1.5 transition ${
              viewMode === 'grid' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
            }`}>
            <LayoutGrid size={16} />
          </button>
        </div>
        {selectedIds.size > 0 && (
          <span className="text-xs font-medium text-slate-500">{ml.itemsSelected(selectedIds.size)}</span>
        )}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm font-semibold text-slate-500">{t.common.loading}</p>
        </div>
      ) : listItems.length === 0 ? (
        <div className={`rounded-2xl border border-dashed px-6 py-16 text-center transition-colors ${
            dragOverId === '__empty__'
              ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200'
              : 'border-slate-200'
          }`}
          onContextMenu={handleBackgroundContextMenu}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOverId('__empty__'); }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOverId(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOverId(null);
            const files = Array.from(e.dataTransfer.files);
            for (const file of files) void handleUpload(file);
          }}>
          <p className={`text-sm ${dragOverId === '__empty__' ? 'text-blue-500 font-medium' : 'text-slate-500'}`}>
            {dragOverId === '__empty__'
              ? ml.dropToUpload
              : assets.length === 0 && folders.length === 0 ? ml.emptyLibrary
              : currentFolderId ? ml.emptyFolder
              : ml.noResults}
          </p>
        </div>
      ) : (
        <div ref={listRef} tabIndex={0} onKeyDown={handleKeyDown}
          onDragEnter={(e) => e.preventDefault()}
          onDragOver={(e) => {
            e.preventDefault();
            const isExternal = e.dataTransfer.types.includes('Files') && draggingIds.size === 0;
            e.dataTransfer.dropEffect = isExternal ? 'copy' : 'move';
            const folderRow = (e.target as HTMLElement).closest('[data-folder-id]');
            const folderId = folderRow?.getAttribute('data-folder-id');
            setDragOverId(folderId ?? '__table__');
          }}
          onDragLeave={(e) => {
            if (!listRef.current?.contains(e.relatedTarget as Node)) {
              setDragOverId(null);
            }
          }}
          onDragEnd={() => { setDragOverId(null); setDraggingIds(new Set()); }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOverId(null);
            // External file drop → upload
            if (e.dataTransfer.files.length > 0 && draggingIds.size === 0) {
              const folderRow = (e.target as HTMLElement).closest('[data-folder-id]');
              const targetFolder = folderRow?.getAttribute('data-folder-id') ?? currentFolderId;
              const files = Array.from(e.dataTransfer.files);
              for (const file of files) void handleUpload(file, targetFolder);
              return;
            }
            if (draggingIds.size === 0) return;
            const folderRow = (e.target as HTMLElement).closest('[data-folder-id]');
            const targetFolderId = folderRow?.getAttribute('data-folder-id') ?? null;
            const dropTarget = targetFolderId || (currentFolderId ?? null);
            const idsToMove = new Set(draggingIds);
            setDraggingIds(new Set());
            void (async () => {
              for (const id of idsToMove) {
                if (id === targetFolderId) continue;
                const isFolder = folders.find((f) => f.id === id);
                if (isFolder) {
                  if (targetFolderId) {
                    let check: string | null = targetFolderId;
                    let isDescendant = false;
                    while (check) {
                      if (check === id) { isDescendant = true; break; }
                      const parent = folders.find((f) => f.id === check);
                      check = parent?.parentFolderId ?? null;
                    }
                    if (!isDescendant) {
                      await updateDoc(doc(db, 'companyMedia', id), { parentFolderId: targetFolderId });
                    }
                  } else {
                    await updateDoc(doc(db, 'companyMedia', id), { parentFolderId: currentFolderId ?? null });
                  }
                } else {
                  await moveAssetToFolder(id, dropTarget);
                }
              }
              setSelectedIds(new Set());
              await load();
            })();
          }}
          onContextMenu={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-list-bg]')) {
              handleBackgroundContextMenu(e);
            }
          }}
          className={`rounded-2xl border bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-200 ${
            dragOverId === '__table__' ? 'border-blue-300 ring-2 ring-blue-200' : 'border-slate-200'
          }`}>
          {viewMode === 'list' ? (
            <>
              {/* Table header */}
              <div onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, item: null }); }}
                className="grid grid-cols-[1fr_100px_80px_100px_100px] gap-2 border-b border-slate-100 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <span>{ml.columnName}</span>
                <span>{ml.columnType}</span>
                <span>{ml.columnSize}</span>
                <span>{ml.columnUsedIn}</span>
                <span>{ml.columnDate}</span>
              </div>

              {/* Rows */}
              <div data-list-bg>
                {listItems.map((item, index) => {
                  const itemId = item._kind === 'folder' ? item.id : ((item as LibraryAsset).libraryDocId ?? item.id);
                  const isSelected = selectedIds.has(itemId);
                  const isFocused = focusedIndex === index;
                  const isCut = cutIds.has(itemId);
                  const isDropTarget = dragOverId === itemId && item._kind === 'folder';
                  const name = getItemName(item);

                  const typeLabel = item._kind === 'folder' ? ml.folder
                    : item.type === 'video' ? ml.filterVideos
                    : item.type === 'document' ? ml.filterDocuments
                    : ml.filterImages;

                  const usedIn = item._kind === 'folder' ? '—' : ml.usedInModules((item as LibraryAsset).moduleRefs.length);
                  const createdAt = item.createdAt ? new Date(item.createdAt).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

                  return (
                    <div key={itemId}
                      {...(item._kind === 'folder' ? { 'data-folder-id': itemId } : {})}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item)}
                      onDragEnter={(e) => e.preventDefault()}
                      onDragOver={(e) => e.preventDefault()}
                      onClick={(e) => handleRowClick(e, item, index)}
                      onDoubleClick={() => handleRowDoubleClick(item)}
                      onContextMenu={(e) => handleContextMenu(e, item, index)}
                      className={`grid cursor-default select-none grid-cols-[1fr_100px_80px_100px_100px] gap-2 border-b border-slate-50 px-4 py-2 text-sm transition-colors
                        ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}
                        ${isFocused ? 'ring-1 ring-inset ring-blue-300' : ''}
                        ${isCut ? 'opacity-50' : ''}
                        ${isDropTarget ? 'bg-blue-100 ring-2 ring-blue-300' : ''}
                      `}>
                      <div className="flex items-center gap-3 overflow-hidden">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center">
                          {item._kind === 'asset' && item.type === 'image' ? (
                            <Image src={item.url} alt={name} width={36} height={36}
                              className="h-9 w-9 rounded object-cover" />
                          ) : (
                            getTypeIcon(item._kind === 'folder' ? 'folder' : (item as LibraryAsset).type)
                          )}
                        </span>
                        {renamingId === itemId ? (
                          <input ref={renameInputRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => void handleRenameSubmit()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleRenameSubmit();
                              if (e.key === 'Escape') setRenamingId(null);
                              e.stopPropagation();
                            }}
                            className="min-w-0 flex-1 rounded border border-blue-300 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                            onClick={(e) => e.stopPropagation()} />
                        ) : (
                          <span className="truncate text-slate-700" title={name}>{name}</span>
                        )}
                      </div>
                      <span className="self-center text-xs text-slate-500">{typeLabel}</span>
                      <span className="self-center text-xs text-slate-400">{item._kind === 'folder' ? '—' : formatFileSize((item as LibraryAsset).fileSize)}</span>
                      <span className="self-center text-xs text-slate-400">{usedIn}</span>
                      <span className="self-center text-xs text-slate-400">{createdAt}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* Grid view */
            <div data-list-bg className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 p-3">
              {listItems.map((item, index) => {
                const itemId = item._kind === 'folder' ? item.id : ((item as LibraryAsset).libraryDocId ?? item.id);
                const isSelected = selectedIds.has(itemId);
                const isFocused = focusedIndex === index;
                const isCut = cutIds.has(itemId);
                const isDropTarget = dragOverId === itemId && item._kind === 'folder';
                const name = getItemName(item);

                return (
                  <div key={itemId}
                    {...(item._kind === 'folder' ? { 'data-folder-id': itemId } : {})}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item)}
                    onDragEnter={(e) => e.preventDefault()}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={(e) => handleRowClick(e, item, index)}
                    onDoubleClick={() => handleRowDoubleClick(item)}
                    onContextMenu={(e) => handleContextMenu(e, item, index)}
                    className={`group flex cursor-default select-none flex-col overflow-hidden rounded-xl border transition-colors
                      ${isSelected ? 'border-blue-300 bg-blue-50 ring-1 ring-blue-200' : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'}
                      ${isFocused ? 'ring-2 ring-blue-300' : ''}
                      ${isCut ? 'opacity-50' : ''}
                      ${isDropTarget ? 'border-blue-400 bg-blue-100 ring-2 ring-blue-300' : ''}
                    `}>
                    <div className="flex aspect-square items-center justify-center overflow-hidden bg-slate-50">
                      {item._kind === 'asset' && item.type === 'image' ? (
                        <Image src={item.url} alt={name} width={320} height={320}
                          className="h-full w-full object-cover" />
                      ) : item._kind === 'asset' && item.type === 'video' ? (
                        <Film size={40} className="text-purple-300" />
                      ) : item._kind === 'folder' ? (
                        <FolderIcon size={40} className="text-amber-300" />
                      ) : (
                        <FileText size={40} className="text-red-300" />
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 px-2.5 py-2">
                      {renamingId === itemId ? (
                        <input ref={renameInputRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => void handleRenameSubmit()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleRenameSubmit();
                            if (e.key === 'Escape') setRenamingId(null);
                            e.stopPropagation();
                          }}
                          className="min-w-0 rounded border border-blue-300 px-1.5 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                          onClick={(e) => e.stopPropagation()} />
                      ) : (
                        <span className="truncate text-xs font-medium text-slate-700" title={name}>{name}</span>
                      )}
                      <span className="truncate text-[10px] text-slate-400">
                        {item._kind === 'folder' ? ml.folder : formatFileSize((item as LibraryAsset).fileSize)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && typeof window !== 'undefined' && createPortal(
        <div ref={contextMenuRef}
          className="fixed z-[100] min-w-[180px] rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
          style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 300) }}>
          {contextMenu.item ? (
            <>
              {/* Open with submenu */}
              {contextMenu.item._kind === 'asset' && (
                <>
                  <button type="button" onClick={() => { setMediaPreview(contextMenu.item as LibraryAsset); closeContextMenu(); }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                    {ml.openPreview}
                  </button>
                  <button type="button" onClick={() => { window.open((contextMenu.item as LibraryAsset).url, '_blank'); closeContextMenu(); }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                    {ml.openNewTab}
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                </>
              )}
              {contextMenu.item._kind === 'folder' && (
                <>
                  <button type="button" onClick={() => { setCurrentFolderId(contextMenu.item!.id); setSelectedIds(new Set()); closeContextMenu(); }}
                    className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                    {ml.openFile}
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                </>
              )}
              <button type="button" onClick={() => {
                const id = contextMenu.item!._kind === 'folder' ? contextMenu.item!.id : ((contextMenu.item as LibraryAsset).libraryDocId ?? contextMenu.item!.id);
                setRenamingId(id); setRenameValue(getItemName(contextMenu.item!)); closeContextMenu();
              }} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                {ml.rename}
                <span className="ml-auto text-[10px] text-slate-400">F2</span>
              </button>
              {contextMenu.item._kind === 'asset' && (
                <button type="button" onClick={() => {
                  void navigator.clipboard.writeText((contextMenu.item as LibraryAsset).url);
                  closeContextMenu();
                }} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                  {ml.copy}
                  <span className="ml-auto text-[10px] text-slate-400">Ctrl+C</span>
                </button>
              )}
              <button type="button" onClick={() => {
                const id = contextMenu.item!._kind === 'folder' ? contextMenu.item!.id : ((contextMenu.item as LibraryAsset).libraryDocId ?? contextMenu.item!.id);
                setCutIds(new Set([id])); closeContextMenu();
              }} className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                {ml.cut}
                <span className="ml-auto text-[10px] text-slate-400">Ctrl+X</span>
              </button>
              <div className="my-1 border-t border-slate-100" />
              <button type="button" onClick={() => { void handleNewFolder(); closeContextMenu(); }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                {ml.newFolder}
              </button>
              <div className="my-1 border-t border-slate-100" />
              <button type="button" onClick={() => { setDeleteTarget(contextMenu.item!); closeContextMenu(); }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                {ml.deleteButton}
                <span className="ml-auto text-[10px] text-red-400">Del</span>
              </button>
            </>
          ) : (
            /* Background context menu */
            <>
              <button type="button" onClick={() => { void handleNewFolder(); closeContextMenu(); }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                {ml.newFolder}
              </button>
              {cutIds.size > 0 && (
                <button type="button" onClick={() => { void handlePaste(); closeContextMenu(); }}
                  className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50">
                  {ml.paste}
                  <span className="ml-auto text-[10px] text-slate-400">Ctrl+V</span>
                </button>
              )}
            </>
          )}
        </div>,
        document.body,
      )}

      {/* Media preview modal */}
      {mediaPreview && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8"
          onClick={() => setMediaPreview(null)}>
          <div className="max-h-[90vh] max-w-[90vw] overflow-auto rounded-2xl bg-white p-2 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            {mediaPreview.type === 'image' ? (
              <Image src={mediaPreview.url} alt={getFileNameFromUrl(mediaPreview.url)} width={900} height={600}
                className="max-h-[80vh] w-auto rounded-xl object-contain" />
            ) : mediaPreview.type === 'video' ? (
              <video src={mediaPreview.url} controls autoPlay className="max-h-[80vh] rounded-xl" />
            ) : (
              <iframe src={mediaPreview.url} className="h-[80vh] w-[70vw] rounded-xl" />
            )}
          </div>
        </div>,
        document.body,
      )}

      {/* Replace broken image modal */}
      {replaceTarget && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!replacing) setReplaceTarget(null); }}>
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">{t.admin.brokenMedia.modalTitle}</p>
              <p className="mt-1 break-all rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-500">
                {getFileNameFromUrl(replaceTarget.url)}
              </p>
            </div>
            <p className="text-sm text-slate-600">{t.admin.brokenMedia.modalBody(replaceTarget.moduleRefs.length)}</p>
            <div className="flex flex-col gap-2 pt-1">
              <button type="button" disabled={replacing} onClick={() => replaceInputRef.current?.click()}
                className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                {replacing ? t.admin.brokenMedia.replacing : t.admin.brokenMedia.uploadButton}
              </button>
              <button type="button" disabled={replacing} onClick={() => setReplaceTarget(null)}
                className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50">
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && typeof window !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!deleting) setDeleteTarget(null); }}>
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-slate-900">
              {deleteTarget._kind === 'folder' ? ml.deleteFolderConfirmTitle : ml.deleteConfirmTitle}
            </p>
            <p className="break-all rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-500">
              {getItemName(deleteTarget)}
            </p>
            <p className="text-sm text-slate-600">
              {deleteTarget._kind === 'folder'
                ? ml.deleteFolderConfirmMessage
                : ml.deleteConfirmMessage((deleteTarget as LibraryAsset).moduleRefs.length)}
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button type="button" disabled={deleting} onClick={() => void handleDelete()}
                className="cursor-pointer rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60">
                {deleting ? ml.deleting : ml.deleteConfirmButton}
              </button>
              <button type="button" disabled={deleting} onClick={() => setDeleteTarget(null)}
                className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50">
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
