'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ChangeEvent } from 'react';
import {
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { useCourseModule } from '@/hooks/useCourseModule';
import SaveChangesButton from '@/components/SaveChangesButton';
import type {
  CourseModulePayload,
  CourseQuestion,
  CourseQuestionAlternative,
  LocaleModuleMediaMap,
  LocaleStringArrayMap,
  LocaleStringMap,
  ModuleMediaItem,
} from '@/types/course';
import { ensureMediaLocales, mediaMapToLegacyArrays } from '@/utils/media';

import Quill from 'quill';
import 'quill/dist/quill.snow.css';


const DEFAULT_LANGUAGES = ['no', 'en'];
const DEFAULT_EXAM_PASS_PERCENTAGE = 80;

const generateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const createEmptyLocaleMap = (languages: string[]): LocaleStringMap =>
  languages.reduce<LocaleStringMap>((acc, lang) => {
    acc[lang] = '';
    return acc;
  }, {});

const createEmptyLocaleArrayMap = (
  languages: string[],
): LocaleStringArrayMap =>
  languages.reduce<LocaleStringArrayMap>((acc, lang) => {
    acc[lang] = [];
    return acc;
  }, {});

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

const createEmptyAlternative = (
  languages: string[],
): CourseQuestionAlternative => ({
  id: generateId(),
  altText: createEmptyLocaleMap(languages),
});

const createEmptyQuestion = (languages: string[]): CourseQuestion => {
  const first = createEmptyAlternative(languages);
  const second = createEmptyAlternative(languages);
  return {
    id: generateId(),
    title: createEmptyLocaleMap(languages),
    contentText: createEmptyLocaleMap(languages),
    alternatives: [first, second],
    correctAnswerIds: [first.id],
    correctAnswerId: first.id,
  };
};

const clampPercentage = (value: number) => Math.min(100, Math.max(0, value));

const ensureLocaleKeys = (
  map: LocaleStringMap | undefined,
  languages: string[],
) => {
  const base = createEmptyLocaleMap(languages);
  if (!map) return base;
  languages.forEach((lang) => {
    base[lang] = map[lang] ?? '';
  });
  return base;
};

const ensureLocaleArrayKeys = (
  map: LocaleStringArrayMap | undefined,
  languages: string[],
) => {
  const base = createEmptyLocaleArrayMap(languages);
  if (!map) return base;
  languages.forEach((lang) => {
    const entries = map[lang];
    if (Array.isArray(entries)) {
      base[lang] = entries;
    } else if (typeof entries === 'string') {
      base[lang] = [entries];
    } else if (entries == null) {
      base[lang] = [];
    } else {
      base[lang] = [String(entries)];
    }
  });
  return base;
};

const getLocaleValue = (map: LocaleStringMap | undefined, lang = 'no') => {
  if (!map) return '';
  if (map[lang]) return map[lang];
  const firstEntry = Object.values(map).find((value) => value?.trim());
  return firstEntry ?? '';
};

const collectLanguagesFromModule = (
  module: CourseModulePayload,
): string[] => {
  const collected = new Set<string>(DEFAULT_LANGUAGES);
  Object.keys(module.title ?? {}).forEach((lang) => collected.add(lang));
  Object.keys(module.summary ?? {}).forEach((lang) => collected.add(lang));
  Object.keys(module.body ?? {}).forEach((lang) => collected.add(lang));
  Object.keys(module.media ?? {}).forEach((lang) => collected.add(lang));
  Object.keys(module.videoUrls ?? {}).forEach((lang) => collected.add(lang));
  Object.keys(module.imageUrls ?? {}).forEach((lang) => collected.add(lang));
  module.questions.forEach((question) => {
    Object.keys(question.title ?? {}).forEach((lang) => collected.add(lang));
    Object.keys(question.contentText ?? {}).forEach((lang) =>
      collected.add(lang),
    );
    question.alternatives.forEach((alt) => {
      Object.keys(alt.altText ?? {}).forEach((lang) => collected.add(lang));
    });
  });
  return Array.from(collected);
};

export default function CourseModuleDetailPage() {
  const params = useParams<{
    courseId?: string | string[];
    moduleId?: string | string[];
  }>();
  const router = useRouter();
  const courseParam = params?.courseId;
  const moduleParam = params?.moduleId;
  const courseId = Array.isArray(courseParam) ? courseParam[0] : courseParam ?? null;
  const moduleId = Array.isArray(moduleParam) ? moduleParam[0] : moduleParam ?? null;

  const { module, loading, error } = useCourseModule(courseId, moduleId);
  const [languages, setLanguages] = useState<string[]>(DEFAULT_LANGUAGES);
  const [activeLanguage, setActiveLanguage] = useState<string>(DEFAULT_LANGUAGES[0]);
  const [draft, setDraft] = useState<CourseModulePayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!module) {
      setDraft(null);
      return;
    }
    const moduleType = module.moduleType === 'exam' ? 'exam' : 'normal';
    const examPassPercentage =
      moduleType === 'exam'
        ? typeof module.examPassPercentage === 'number'
          ? module.examPassPercentage
          : DEFAULT_EXAM_PASS_PERCENTAGE
        : undefined;
    const provisionalDraft: CourseModulePayload = {
      title: module.title ?? {},
      summary: module.summary ?? {},
      body: module.body ?? {},
      media: module.media ?? {},
      videoUrls: module.videoUrls ?? {},
      imageUrls: module.imageUrls ?? {},
      order: module.order ?? 0,
      questions: module.questions ?? [],
      moduleType,
      examPassPercentage,
    };

    const discoveredLanguages = collectLanguagesFromModule(provisionalDraft);
    setLanguages(discoveredLanguages);
    if (!discoveredLanguages.includes(activeLanguage)) {
      setActiveLanguage(discoveredLanguages[0] ?? 'no');
    }

    setDraft({
      ...provisionalDraft,
      title: ensureLocaleKeys(provisionalDraft.title, discoveredLanguages),
      summary: ensureLocaleKeys(provisionalDraft.summary, discoveredLanguages),
      body: ensureLocaleKeys(provisionalDraft.body, discoveredLanguages),
      media: ensureMediaLocales(provisionalDraft.media, discoveredLanguages),
      videoUrls: ensureLocaleArrayKeys(provisionalDraft.videoUrls, discoveredLanguages),
      imageUrls: ensureLocaleArrayKeys(provisionalDraft.imageUrls, discoveredLanguages),
      questions: provisionalDraft.questions.map((question) => ({
        ...question,
        title: ensureLocaleKeys(question.title, discoveredLanguages),
        contentText: ensureLocaleKeys(question.contentText, discoveredLanguages),
        alternatives: question.alternatives.map((alt) => ({
          ...alt,
          altText: ensureLocaleKeys(alt.altText, discoveredLanguages),
        })),
      })),
    });
  }, [module]); // eslint-disable-line react-hooks/exhaustive-deps

  const moduleTitle = useMemo(() => module?.title ?? '', [module]);
  const fallbackTitle = useMemo(() => {
    if (typeof moduleTitle === 'string') {
      return moduleTitle;
    }
    return getLocaleValue(moduleTitle, activeLanguage) || (moduleId ?? '');
  }, [moduleTitle, activeLanguage, moduleId]);

  const addLanguage = (lang: string) => {
    const trimmed = lang.trim().toLowerCase();
    if (!trimmed) return;
    if (languages.includes(trimmed)) {
      setActiveLanguage(trimmed);
      return;
    }

    const nextLanguages = [...languages, trimmed];
    setLanguages(nextLanguages);
    setActiveLanguage(trimmed);
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            title: ensureLocaleKeys(prev.title, nextLanguages),
            summary: ensureLocaleKeys(prev.summary, nextLanguages),
            body: ensureLocaleKeys(prev.body, nextLanguages),
            media: ensureMediaLocales(prev.media, nextLanguages),
            videoUrls: ensureLocaleArrayKeys(prev.videoUrls, nextLanguages),
            imageUrls: ensureLocaleArrayKeys(prev.imageUrls, nextLanguages),
            questions: prev.questions.map((question) => ({
              ...question,
              title: ensureLocaleKeys(question.title, nextLanguages),
              contentText: ensureLocaleKeys(question.contentText, nextLanguages),
              alternatives: question.alternatives.map((alt) => ({
                ...alt,
                altText: ensureLocaleKeys(alt.altText, nextLanguages),
              })),
            })),
          }
        : prev,
    );
  };

  const updateField = <K extends keyof CourseModulePayload>(
    key: K,
    value: CourseModulePayload[K],
  ) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!courseId || !moduleId || !draft) return;
    try {
      setSaving(true);
      setFormError(null);
      const normalizedMedia = ensureMediaLocales(draft.media, languages);
      const { imageUrls, videoUrls } = mediaMapToLegacyArrays(normalizedMedia);
      const updatePayload: Record<string, unknown> = {
        title: draft.title ?? {},
        summary: draft.summary ?? {},
        body: draft.body ?? {},
        media: normalizedMedia,
        videoUrls,
        imageUrls,
        order: draft.order ?? 0,
        questions: draft.questions ?? [],
        moduleType: draft.moduleType ?? 'normal',
        updatedAt: serverTimestamp(),
      };
      if (draft.moduleType === 'exam') {
        const passValue =
          typeof draft.examPassPercentage === 'number'
            ? draft.examPassPercentage
            : DEFAULT_EXAM_PASS_PERCENTAGE;
        updatePayload.examPassPercentage = clampPercentage(
          Math.round(passValue),
        );
      }
      await updateDoc(doc(db, 'courses', courseId, 'modules', moduleId), updatePayload);
    } catch (err) {
      console.error('Failed to update module', err);
      setFormError(
        err instanceof Error ? err.message : 'Kunne ikke oppdatere emnet.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = () => {
     if (!courseId || !moduleId) return;
    const url = `/courses/${courseId}/modules/${moduleId}/preview?lang=${activeLanguage}`;
    if (typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      router.push(url);
    }
  };

  const handleDelete = async () => {
    if (!courseId || !moduleId || !draft) return;
    const confirmed = window.confirm(
      `Slett emnet "${getLocaleValue(draft.title, activeLanguage)}"? Dette kan ikke angres.`,
    );
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, 'courses', courseId, 'modules', moduleId));
      router.push(`/courses/${courseId}`);
    } catch (err) {
      console.error('Failed to delete module', err);
      setFormError(
        err instanceof Error ? err.message : 'Kunne ikke slette emnet.',
      );
    }
  };

  if (!courseId || !moduleId) {
    return (
      <section className="space-y-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          Mangler informasjon om kurs eller emne.
        </div>
      </section>
    );
  }

  if (loading || !draft) {
    return (
      <section className="space-y-6">
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {error ?? 'Laster emnet …'}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/courses/${courseId}`}
            className="text-sm font-semibold text-slate-600 transition hover:text-slate-900"
          >
            ← Tilbake til kurs
          </Link>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Emneadministrasjon
          </p>
        </div>
        <div className="flex items-center gap-2">
          {languages.map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setActiveLanguage(lang)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                activeLanguage === lang
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {lang.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              const next = prompt('Legg til språk (f.eks. sv)');
              if (next) addLanguage(next);
            }}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            +
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {fallbackTitle || 'Emne'}
            </h1>
            <p className="text-sm text-slate-500">
              Administrer innhold, media og kontrollspørsmål for emnet.
            </p>
          </div>
          <button
            onClick={handleDelete}
            className="rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50"
          >
            Slett emne
          </button>
        </div>

        <div className="mt-6 space-y-6">
          <LocaleFieldEditor
            label="Emnetittel"
            value={draft.title ?? {}}
            onChange={(next) => updateField('title', next)}
            activeLanguage={activeLanguage}
          />

          <LocaleFieldEditor
            label="Sammendrag"
            value={draft.summary ?? {}}
            onChange={(next) => updateField('summary', next)}
            activeLanguage={activeLanguage}
            multiline
          />

          <LocaleRichEditor
            label="Innhold"
            value={draft.body ?? {}}
            onChange={(next) => updateField('body', next)}
            activeLanguage={activeLanguage}
          />

          <LocaleMediaEditor
            label="Media"
            media={draft.media ?? {}}
            onChange={(next) => updateField('media', next)}
            activeLanguage={activeLanguage}
            courseId={courseId}
            moduleId={moduleId}
          />

          {draft.moduleType === 'exam' && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Eksamen</p>
                  <p className="text-xs text-slate-500">
                    Angi hvor stor andel riktige svar som kreves for å bestå.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <span>Beståelseskrav</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={draft.examPassPercentage ?? DEFAULT_EXAM_PASS_PERCENTAGE}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      updateField(
                        'examPassPercentage',
                        Number.isFinite(parsed) ? parsed : DEFAULT_EXAM_PASS_PERCENTAGE,
                      );
                    }}
                    className="w-24 rounded-xl border border-slate-200 px-3 py-2 text-right focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  />
                  <span className="text-xs text-slate-500">%</span>
                </label>
              </div>
            </div>
          )}

          <QuestionListEditor
            questions={draft.questions}
            onChange={(next) => updateField('questions', next)}
            languages={languages}
            activeLanguage={activeLanguage}
          />
        </div>

        {formError && (
          <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {formError}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={() => router.push(`/courses/${courseId}`)}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            type="button"
          >
            Avbryt
          </button>
          <button
            onClick={handlePreview}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            type="button"
          >
            Forhåndsvis
          </button>
          <SaveChangesButton type="button" onClick={handleSave} loading={saving} />
        </div>
      </div>
    </section>
  );
}

const LocaleFieldEditor = ({
  label,
  value,
  onChange,
  activeLanguage,
  multiline,
}: {
  label: string;
  value: LocaleStringMap;
  onChange: (next: LocaleStringMap) => void;
  activeLanguage: string;
  multiline?: boolean;
}) => {
  const currentValue = value?.[activeLanguage] ?? '';

  const updateValue = (nextValue: string) => {
    const next: LocaleStringMap = { ...(value ?? {}) };
    next[activeLanguage] = nextValue;
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {activeLanguage.toUpperCase()}
        </span>
      </div>
      {multiline ? (
        <textarea
          value={currentValue}
          onChange={(e) => updateValue(e.target.value)}
          rows={4}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      ) : (
        <input
          value={currentValue}
          onChange={(e) => updateValue(e.target.value)}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      )}
    </div>
  );
};

const QuillEditor = ({
  value,
  onChange,
  modules,
  formats,
}: {
  value: string;
  onChange: (nextValue: string) => void;
  modules: Record<string, unknown>;
  formats: string[];
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const quillRef = useRef<Quill | null>(null);
  const lastHtmlRef = useRef<string>(value ?? '');
  const [showTableActions, setShowTableActions] = useState(false);
  const [tableActionsHost, setTableActionsHost] = useState<HTMLElement | null>(null);
  type TableAction =
    | 'insertRowAbove'
    | 'insertRowBelow'
    | 'insertColumnLeft'
    | 'insertColumnRight'
    | 'deleteRow'
    | 'deleteColumn'
    | 'deleteTable';

  const updateTableActions = useCallback((range: { index: number; length: number } | null) => {
    const quill = quillRef.current;
    if (!quill || !range) {
      setShowTableActions(false);
      return;
    }
    const formats = quill.getFormat(range);
    setShowTableActions(Boolean((formats as { table?: unknown }).table));
  }, []);

  useEffect(() => {
    if (!containerRef.current || quillRef.current) {
      return;
    }

    const quill = new Quill(containerRef.current, {
      theme: 'snow',
      modules,
      formats,
    });

    quill.root.style.minHeight = '160px';

    quill.on('text-change', (_delta, _oldDelta, source) => {
      if (source !== 'user') {
        return;
      }
      const html = quill.root.innerHTML;
      if (html !== lastHtmlRef.current) {
        lastHtmlRef.current = html;
        onChange(html);
      }
      updateTableActions(quill.getSelection());
    });

    quill.on('selection-change', (range) => {
      updateTableActions(range);
    });

    quillRef.current = quill;

    const toolbarModule = quill.getModule('toolbar') as { container?: HTMLElement } | undefined;
    const toolbarContainer = toolbarModule?.container;
    if (toolbarContainer?.parentElement) {
      let host = toolbarContainer.parentElement.querySelector(
        '.quill-table-actions-host',
      ) as HTMLElement | null;
      if (!host) {
        host = document.createElement('div');
        host.className = 'quill-table-actions-host';
        toolbarContainer.parentElement.insertBefore(host, toolbarContainer.nextSibling);
      }
      setTableActionsHost(host);
    }

    if (value) {
      quill.clipboard.dangerouslyPasteHTML(value, 'silent');
    } else {
      quill.setText('', 'silent');
    }
    lastHtmlRef.current = quill.root.innerHTML;
    updateTableActions(quill.getSelection());
  }, [formats, modules, onChange, value]);

  useEffect(() => {
    const quill = quillRef.current;
    if (!quill) {
      return;
    }
    const nextHtml = value ?? '';
    if (nextHtml === lastHtmlRef.current || nextHtml === quill.root.innerHTML) {
      return;
    }
    const selection = quill.getSelection();
    if (nextHtml) {
      quill.clipboard.dangerouslyPasteHTML(nextHtml, 'silent');
    } else {
      quill.setText('', 'silent');
    }
    lastHtmlRef.current = quill.root.innerHTML;
    if (selection) {
      quill.setSelection(selection);
    }
  }, [value]);

  const handleTableAction = (action: TableAction) => {
    const quill = quillRef.current;
    if (!quill) {
      return;
    }
    const tableModule = quill.getModule('table') as
      | Record<string, (() => void) | undefined>
      | undefined;
    const handler = tableModule?.[action];
    if (typeof handler === 'function') {
      handler.call(tableModule);
      quill.focus();
      updateTableActions(quill.getSelection());
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div ref={containerRef} />
      {showTableActions &&
        tableActionsHost &&
        createPortal(
          <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            <span className="mr-2 text-[11px] uppercase tracking-wide text-slate-500">
              Tabell
            </span>
            <button
              type="button"
              onClick={() => handleTableAction('insertRowAbove')}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Ny rad over
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('insertRowBelow')}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Ny rad under
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('insertColumnLeft')}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Ny kolonne venstre
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('insertColumnRight')}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Ny kolonne høyre
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('deleteRow')}
              className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              Slett rad
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('deleteColumn')}
              className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              Slett kolonne
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('deleteTable')}
              className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              Slett tabell
            </button>
          </div>,
          tableActionsHost,
        )}
    </div>
  );
};

const LocaleRichEditor = ({
  label,
  value,
  onChange,
  activeLanguage,
}: {
  label: string;
  value: LocaleStringMap;
  onChange: (next: LocaleStringMap) => void;
  activeLanguage: string;
}) => {
  const currentValue = value?.[activeLanguage] ?? '';
  const updateValue = (nextValue: string) => {
    const next: LocaleStringMap = { ...(value ?? {}) };
    next[activeLanguage] = nextValue;
    onChange(next);
  };

  const modulesConfig = useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link', 'clean'],
          ['table'],
        ],
        handlers: {
          table(this: { quill: Quill }) {
            const tableModule = this.quill?.getModule('table') as
              | { insertTable?: (rows: number, columns: number) => void }
              | undefined;
            if (tableModule?.insertTable) {
              tableModule.insertTable(3, 3);
            }
          },
        },
      },
      table: true,
    }),
    [],
  );

  const formats = useMemo(
    () => [
      'header',
      'bold',
      'italic',
      'underline',
      'strike',
      'list',
      'bullet',
      'ordered',
      'link',
      // Quill v2 built-in table formats
      'table',
      'table-row',
      'table-body',
      'table-container',
    ],
    [],
  );

  const handleChange = (content: string) => {
    updateValue(content);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {activeLanguage.toUpperCase()}
        </span>
      </div>
      <QuillEditor
        value={currentValue}
        onChange={handleChange}
        modules={modulesConfig}
        formats={formats}
      />
      <p className="text-xs text-slate-400">
        Velg tekst og bruk verktøylinjen for å formatere innholdet.
      </p>
    </div>
  );
};

const LocaleMediaEditor = ({
  label,
  media,
  onChange,
  activeLanguage,
  courseId,
  moduleId,
}: {
  label: string;
  media: LocaleModuleMediaMap;
  onChange: (next: LocaleModuleMediaMap) => void;
  activeLanguage: string;
  courseId: string;
  moduleId: string;
}) => {
  const items = media?.[activeLanguage] ?? [];
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const showUrlButtons = false; // Hide manual URL entry until further notice
  const [uploading, setUploading] = useState<'image' | 'video' | 'document' | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const updateList = useCallback(
    (next: ModuleMediaItem[]) => {
      onChange({
        ...(media ?? {}),
        [activeLanguage]: next,
      });
    },
    [media, activeLanguage, onChange],
  );

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

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = items.findIndex((item) => item.id === event.active.id);
    const newIndex = items.findIndex((item) => item.id === event.over?.id);
    if (oldIndex === -1 || newIndex === -1) return;
    updateList(arrayMove(items, oldIndex, newIndex));
  };

  const handleRemove = (id: string) => {
    const target = items.find((item) => item.id === id);
    updateList(items.filter((item) => item.id !== id));
    if (target) {
      void maybeDeleteUploadedFile(target.url);
    }
  };

  const handleTypeChange = (id: string, type: ModuleMediaItem['type']) => {
    updateList(
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              type,
            }
          : item,
      ),
    );
  };

  const handleUploadClick = (type: 'image' | 'video' | 'document') => {
    if (type === 'image') {
      imageInputRef.current?.click();
    } else if (type === 'video') {
      videoInputRef.current?.click();
    } else {
      documentInputRef.current?.click();
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
      updateList([
        ...items,
        {
          id: generateId(),
          url,
          type,
        },
      ]);
    } catch (err) {
      console.error('Failed to upload file', err);
      alert('Kunne ikke laste opp filen. Prøv igjen.');
    } finally {
      setUploading(null);
    }
  };

  const handleAddUrl = (type: 'image' | 'video' | 'document') => {
    const promptLabel =
      type === 'image'
        ? 'Lim inn URL til bilde'
        : type === 'video'
          ? 'Lim inn URL til video (YouTube eller videofil)'
          : 'Lim inn URL til PDF eller annet dokument';
    const next = window.prompt(promptLabel);
    if (!next) return;
    const trimmed = next.trim();
    if (!trimmed) return;
    updateList([
      ...items,
      {
        id: generateId(),
        url: trimmed,
        type,
      },
    ]);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {activeLanguage.toUpperCase()}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          Ingen media er lagt til for dette språket ennå.
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((item) => (
                <SortableMediaCard
                  key={item.id}
                  item={item}
                  onRemove={() => handleRemove(item.id)}
                  onTypeChange={(type) => handleTypeChange(item.id, type)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleUploadClick('image')}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={uploading === 'image'}
        >
          {uploading === 'image' ? 'Laster opp …' : 'Last opp bilde'}
        </button>
        <button
          type="button"
          onClick={() => handleUploadClick('video')}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={uploading === 'video'}
        >
          {uploading === 'video' ? 'Laster opp …' : 'Last opp video'}
        </button>
        <button
          type="button"
          onClick={() => handleUploadClick('document')}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={uploading === 'document'}
        >
          {uploading === 'document' ? 'Laster opp …' : 'Last opp PDF'}
        </button>
        {showUrlButtons && (
          <>
            <button
              type="button"
              onClick={() => handleAddUrl('image')}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              Legg til bilde-URL
            </button>
            <button
              type="button"
              onClick={() => handleAddUrl('video')}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              Legg til video-URL
            </button>
            <button
              type="button"
              onClick={() => handleAddUrl('document')}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              Legg til dokument-URL
            </button>
          </>
        )}
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

const getFileNameFromUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    const segments = pathname.split('/');
    const candidate = segments.pop();
    if (candidate && candidate.trim()) {
      return candidate;
    }
    return parsed.hostname;
  } catch {
    const parts = url.split('/');
    return decodeURIComponent(parts[parts.length - 1] || url);
  }
};

const SortableMediaCard = ({
  item,
  onRemove,
  onTypeChange,
}: {
  item: ModuleMediaItem;
  onRemove: () => void;
  onTypeChange: (type: ModuleMediaItem['type']) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };
  const typeLabel =
    item.type === 'video' ? 'Video' : item.type === 'document' ? 'Dokument' : 'Bilde';
  const documentName = item.type === 'document' ? getFileNameFromUrl(item.url) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${
        isDragging ? 'ring-2 ring-slate-300' : ''
      }`}
    >
      <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab rounded border border-slate-200 px-2 py-1 text-slate-700"
          aria-label="Flytt"
        >
          ⇅
        </button>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-600">
          {typeLabel}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex h-48 w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          {item.type === 'image' ? (
            <img src={item.url} alt="Forhåndsvis media" className="h-full w-full object-cover" />
          ) : item.type === 'video' ? (
            isYouTubeUrl(item.url) ? (
              <iframe
                src={item.url}
                title="Video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            ) : (
              <video controls className="h-full w-full object-cover">
                <source src={item.url} />
                Nettleseren støtter ikke videoavspilling.
              </video>
            )
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center text-slate-600">
              <span className="text-4xl" role="img" aria-label="Dokument">
                📄
              </span>
              <p className="text-xs font-semibold break-words">{documentName ?? 'Dokument'}</p>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-600">
            Type
            <div className="relative mt-1 w-full max-w-xs">
              <select
                value={item.type}
                onChange={(e) => onTypeChange(e.target.value as ModuleMediaItem['type'])}
                className="appearance-none w-full rounded-xl border border-slate-200 px-3 py-2 pr-10 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="image">Bilde</option>
                <option value="video">Video</option>
                <option value="document">Dokument (PDF)</option>
              </select>
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 0 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.25 8.29a.75.75 0 0 1-.02-1.08z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            </div>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.open(item.url, '_blank')}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              Åpne
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50"
            >
              Fjern
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const QuestionListEditor = ({
  questions,
  onChange,
  languages,
  activeLanguage,
}: {
  questions: CourseQuestion[];
  onChange: (next: CourseQuestion[]) => void;
  languages: string[];
  activeLanguage: string;
}) => {
  const addQuestion = () => {
    onChange([...questions, createEmptyQuestion(languages)]);
  };

  const updateQuestion = (index: number, question: CourseQuestion) => {
    const next = [...questions];
    next[index] = question;
    onChange(next);
  };

  const removeQuestion = (index: number) => {
    onChange(questions.filter((_, idx) => idx !== index));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">
          Kontrollspørsmål ({questions.length})
        </p>
        <button
          type="button"
          onClick={addQuestion}
          className="rounded-xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
        >
          Legg til spørsmål
        </button>
      </div>
      {questions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          Ingen kontrollspørsmål lagt til ennå.
        </div>
      ) : (
        questions.map((question, index) => (
          <QuestionEditor
            key={question.id}
            index={index}
            question={question}
            onChange={(next) => updateQuestion(index, next)}
            onRemove={() => removeQuestion(index)}
            languages={languages}
            activeLanguage={activeLanguage}
          />
        ))
      )}
    </div>
  );
};

const QuestionEditor = ({
  question,
  onChange,
  onRemove,
  languages,
  activeLanguage,
  index,
}: {
  question: CourseQuestion;
  onChange: (next: CourseQuestion) => void;
  onRemove: () => void;
  languages: string[];
  activeLanguage: string;
  index: number;
}) => {
  const updateLocaleField = (key: 'title' | 'contentText', map: LocaleStringMap) => {
    onChange({ ...question, [key]: map });
  };

  const addAlternative = () => {
    onChange({
      ...question,
      alternatives: [...question.alternatives, createEmptyAlternative(languages)],
    });
  };

  const updateAlternative = (altId: string, map: LocaleStringMap) => {
    onChange({
      ...question,
      alternatives: question.alternatives.map((alt) =>
        alt.id === altId ? { ...alt, altText: map } : alt,
      ),
    });
  };

  const currentCorrectIds = Array.isArray(question.correctAnswerIds)
    ? question.correctAnswerIds
    : question.correctAnswerId
      ? [question.correctAnswerId]
      : [];

  const removeAlternative = (altId: string) => {
    const filtered = question.alternatives.filter((alt) => alt.id !== altId);
    let nextCorrectIds = currentCorrectIds.filter((id) => id !== altId);
    if (nextCorrectIds.length === 0 && filtered.length > 0) {
      nextCorrectIds = [filtered[0].id];
    }
    onChange({
      ...question,
      alternatives: filtered,
      correctAnswerIds: nextCorrectIds,
      correctAnswerId: nextCorrectIds[0],
    });
  };

  const toggleCorrectAnswer = (altId: string) => {
    let nextCorrectIds = currentCorrectIds.includes(altId)
      ? currentCorrectIds.filter((id) => id !== altId)
      : [...currentCorrectIds, altId];
    if (nextCorrectIds.length === 0) {
      nextCorrectIds = [altId];
    }
    const ordered = question.alternatives
      .map((alt) => alt.id)
      .filter((id) => nextCorrectIds.includes(id));
    onChange({
      ...question,
      correctAnswerIds: ordered.length ? ordered : nextCorrectIds,
      correctAnswerId: (ordered.length ? ordered : nextCorrectIds)[0],
    });
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Spørsmål #{index + 1}
          </p>
          <p className="text-xs text-slate-500">
            {question.alternatives.length} alternativer
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50"
        >
          Fjern spørsmål
        </button>
      </div>

      <div className="mt-4 space-y-4">
        <LocaleFieldEditor
          label="Spørsmålstekst"
          value={question.contentText}
          onChange={(next) => updateLocaleField('contentText', next)}
          activeLanguage={activeLanguage}
          multiline
        />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700">Svaralternativer</p>
            <button
              type="button"
              onClick={addAlternative}
              className="rounded-xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              Legg til alternativ
            </button>
          </div>

          {question.alternatives.map((alternative, idx) => (
            <div
              key={alternative.id}
              className="rounded-xl border border-slate-200 bg-slate-50 p-3"
            >
              <div className="flex items-start justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Alternativ {idx + 1}
                </p>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={currentCorrectIds.includes(alternative.id)}
                      onChange={() => toggleCorrectAnswer(alternative.id)}
                    />
                    Riktig svar
                  </label>
                  {question.alternatives.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeAlternative(alternative.id)}
                      className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50"
                    >
                      Fjern
                    </button>
                  )}
                </div>
              </div>

              <LocaleFieldEditor
                label="Alternativ tekst"
                value={alternative.altText}
                onChange={(next) => updateAlternative(alternative.id, next)}
                activeLanguage={activeLanguage}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};


