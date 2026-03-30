'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { createPortal } from 'react-dom';
import type { ChangeEvent } from 'react';
import {
  DndContext,
  DragOverlay,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
  PointerSensor,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { db, storage } from '@/lib/firebase';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import { useCourseModule } from '@/hooks/useCourseModule';
import SaveChangesButton from '@/components/SaveChangesButton';
import DragHandle, { DragHandleIcon } from '@/components/DragHandle';
import DuplicateButton from '@/components/DuplicateButton';
import SelectWithToggleIcon from '@/components/SelectWithToggleIcon';
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
  map: Record<string, unknown> | undefined,
  languages: string[],
) => {
  const base = createEmptyLocaleArrayMap(languages);
  if (!map) return base;
  languages.forEach((lang) => {
    const entries = map[lang];
    if (Array.isArray(entries)) {
      base[lang] = entries;
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
  const collected = new Set<string>();
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
  if (!collected.size) collected.add('no');
  return Array.from(collected);
};

export default function CourseModuleDetailPage() {
  const params = useParams<{
    courseId?: string | string[];
    moduleId?: string | string[];
  }>();
  const router = useRouter();
  const { locale } = useLocale();
  const t = getTranslation(locale);
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
  const [isAddingLanguage, setIsAddingLanguage] = useState(false);
  const [languageInput, setLanguageInput] = useState('');
  const [languageInputError, setLanguageInputError] = useState(false);
  const languageInputRef = useRef<HTMLInputElement | null>(null);
  const initializedModuleIdRef = useRef<string | null>(null);
  const languageScrollRestoreRef = useRef<number | null>(null);

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
      mediaSync: module.mediaSync ?? false,
    };

    const isFirstLoad = initializedModuleIdRef.current !== moduleId;
    let nextLanguages: string[];
    if (module.languages?.length) {
      nextLanguages = module.languages;
    } else if (isFirstLoad) {
      const discovered = collectLanguagesFromModule(provisionalDraft);
      nextLanguages = Array.from(new Set([...DEFAULT_LANGUAGES, ...discovered]));
    } else {
      nextLanguages = collectLanguagesFromModule(provisionalDraft);
    }

    if (isFirstLoad) {
      initializedModuleIdRef.current = moduleId;
    }

    setLanguages(nextLanguages);
    if (!nextLanguages.includes(activeLanguage)) {
      setActiveLanguage(nextLanguages[0] ?? 'no');
    }

    setDraft({
      ...provisionalDraft,
      title: ensureLocaleKeys(provisionalDraft.title, nextLanguages),
      summary: ensureLocaleKeys(provisionalDraft.summary, nextLanguages),
      body: ensureLocaleKeys(provisionalDraft.body, nextLanguages),
      media: ensureMediaLocales(provisionalDraft.media, nextLanguages),
      videoUrls: ensureLocaleArrayKeys(provisionalDraft.videoUrls, nextLanguages),
      imageUrls: ensureLocaleArrayKeys(provisionalDraft.imageUrls, nextLanguages),
      questions: provisionalDraft.questions.map((question) => ({
        ...question,
        title: ensureLocaleKeys(question.title, nextLanguages),
        contentText: ensureLocaleKeys(question.contentText, nextLanguages),
        alternatives: question.alternatives.map((alt) => ({
          ...alt,
          altText: ensureLocaleKeys(alt.altText, nextLanguages),
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

  const handleLanguageSelect = (lang: string) => {
    if (lang === activeLanguage) {
      return;
    }
    if (typeof window !== 'undefined') {
      languageScrollRestoreRef.current = window.scrollY;
    }
    setActiveLanguage(lang);
  };

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
    setLanguageInput('');
    setIsAddingLanguage(false);
    setDraft((prev) => {
      if (!prev) return prev;
      const baseMedia = ensureMediaLocales(prev.media, nextLanguages);
      if (prev.mediaSync) {
        const sourceItems =
          prev.media?.[languages[0]] ?? prev.media?.[Object.keys(prev.media)[0]] ?? [];
        if (sourceItems.length > 0) {
          baseMedia[trimmed] = sourceItems.map((item) => ({ ...item }));
        }
      }
      return {
        ...prev,
        title: ensureLocaleKeys(prev.title, nextLanguages),
        summary: ensureLocaleKeys(prev.summary, nextLanguages),
        body: ensureLocaleKeys(prev.body, nextLanguages),
        media: baseMedia,
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
      };
    });
  };

  const removeLanguage = (lang: string) => {
    if (languages.length <= 1) return;
    const nextLanguages = languages.filter((l) => l !== lang);
    setLanguages(nextLanguages);
    if (activeLanguage === lang) {
      setActiveLanguage(nextLanguages[0]);
    }
    const stripKey = (map: LocaleStringMap | undefined): LocaleStringMap => {
      const next = { ...(map ?? {}) };
      delete next[lang];
      return next;
    };
    const stripArrayKey = (map: Record<string, string[]> | undefined): Record<string, string[]> => {
      const next = { ...(map ?? {}) };
      delete next[lang];
      return next;
    };
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            title: stripKey(prev.title),
            summary: stripKey(prev.summary),
            body: stripKey(prev.body),
            media: (() => {
              const next = { ...(prev.media ?? {}) };
              delete next[lang];
              return next;
            })(),
            videoUrls: stripArrayKey(prev.videoUrls as Record<string, string[]>),
            imageUrls: stripArrayKey(prev.imageUrls as Record<string, string[]>),
            questions: prev.questions.map((question) => ({
              ...question,
              title: stripKey(question.title),
              contentText: stripKey(question.contentText),
              alternatives: question.alternatives.map((alt) => ({
                ...alt,
                altText: stripKey(alt.altText),
              })),
            })),
          }
        : prev,
    );
  };

  const handleRemoveActiveLanguage = () => {
    if (languages.length <= 1) {
      return;
    }
    const confirmed = window.confirm(
      t.admin.moduleDetail.confirmRemoveLanguage(activeLanguage.toUpperCase()),
    );
    if (!confirmed) {
      return;
    }
    removeLanguage(activeLanguage);
  };

  useEffect(() => {
    if (isAddingLanguage) {
      requestAnimationFrame(() => {
        languageInputRef.current?.focus();
      });
    }
  }, [isAddingLanguage]);

  useEffect(() => {
    const top = languageScrollRestoreRef.current;
    if (top == null || typeof window === 'undefined') {
      return;
    }
    languageScrollRestoreRef.current = null;
    requestAnimationFrame(() => {
      window.scrollTo({ top, behavior: 'auto' });
    });
  }, [activeLanguage]);

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
        languages,
        mediaSync: draft.mediaSync ?? false,
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
        err instanceof Error ? err.message : t.admin.moduleDetail.saveModuleError,
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
      t.admin.moduleDetail.confirmDeleteModule(getLocaleValue(draft.title, activeLanguage)),
    );
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, 'courses', courseId, 'modules', moduleId));
      router.push(`/courses/${courseId}`);
    } catch (err) {
      console.error('Failed to delete module', err);
      setFormError(
        err instanceof Error ? err.message : t.admin.moduleDetail.deleteModuleError,
      );
    }
  };

  if (!courseId || !moduleId) {
    return (
      <section className="space-y-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          {t.admin.moduleDetail.missingParams}
        </div>
      </section>
    );
  }

  if (loading || !draft) {
    return (
      <section className="space-y-6">
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {error ?? t.admin.moduleDetail.loading}
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
            className="cursor-pointer text-sm font-semibold text-slate-600 transition hover:text-slate-900"
          >
            {t.admin.moduleDetail.backToCourseAdmin}
          </Link>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t.admin.moduleDetail.moduleAdmin}
          </p>
        </div>
      </div>

      <div className="flex min-h-18 flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {languages.map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => handleLanguageSelect(lang)}
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition ${
                activeLanguage === lang
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {lang.toUpperCase()}
            </button>
          ))}
          {isAddingLanguage ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setLanguageInputError(false);
                addLanguage(languageInput);
              }}
              className="relative flex items-center gap-2"
            >
              <input
                ref={languageInputRef}
                value={languageInput}
                onChange={(e) => {
                  const raw = e.target.value;
                  const cleaned = raw.replace(/[^a-zA-Z]/g, '');
                  setLanguageInputError(cleaned !== raw && raw.length > 0);
                  setLanguageInput(cleaned);
                }}
                placeholder={t.common.languageCode}
                className="rounded-lg border border-slate-200 px-2 py-1 text-xs focus:border-slate-400 focus:outline-none"
              />
              <button
                type="submit"
                className="cursor-pointer rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800"
              >
                {t.common.add}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingLanguage(false);
                  setLanguageInput('');
                  setLanguageInputError(false);
                }}
                className="cursor-pointer rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:border-slate-300 hover:bg-slate-50"
                aria-label={t.common.cancel}
              >
                ×
              </button>
              {languageInputError && (
                <p className="pointer-events-none absolute left-0 top-full mt-1 whitespace-nowrap text-xs text-red-500">
                  {t.common.languageCodeOnlyLetters}
                </p>
              )}
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setIsAddingLanguage(true);
                  setLanguageInput('');
                }}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-slate-200 p-0 text-sm font-semibold leading-none text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                aria-label={t.common.addLanguage}
              >
                +
              </button>
              <button
                type="button"
                onClick={handleRemoveActiveLanguage}
                disabled={languages.length <= 1}
                className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-red-200 p-0 text-sm font-semibold leading-none text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300 disabled:hover:bg-transparent"
                aria-label={t.common.removeLanguageLabel(activeLanguage.toUpperCase())}
                title={t.common.removeLanguageTitle(activeLanguage.toUpperCase())}
              >
                -
              </button>
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t.admin.moduleDetail.moduleInfoLabel}
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">
              {fallbackTitle || t.admin.moduleDetail.moduleTitle}
            </h1>
            <p className="text-sm text-slate-500">
              {t.admin.moduleDetail.moduleInfoSubtitle}
            </p>
          </div>
          <button
            onClick={handleDelete}
            className="cursor-pointer rounded-full border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50"
          >
            {t.admin.moduleDetail.removeModule}
          </button>
        </div>

        <div className="mt-6 space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <LocaleFieldEditor
                  label={t.common.title}
                  value={draft.title ?? {}}
                  onChange={(next) => updateField('title', next)}
                  activeLanguage={activeLanguage}
                  variant="courseInfo"
                />

                <LocaleFieldEditor
                  label={t.common.description}
                  value={draft.summary ?? {}}
                  onChange={(next) => updateField('summary', next)}
                  activeLanguage={activeLanguage}
                  multiline
                  variant="courseInfo"
                  containerClassName="md:col-span-2"
                />
              </div>

              <LocaleRichEditor
                label={t.admin.moduleDetail.contentField}
                value={draft.body ?? {}}
                onChange={(next) => updateField('body', next)}
                activeLanguage={activeLanguage}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <LocaleMediaEditor
              label={t.admin.moduleDetail.mediaField}
              media={draft.media ?? {}}
              onChange={(next) => updateField('media', next)}
              activeLanguage={activeLanguage}
              courseId={courseId}
              moduleId={moduleId}
              languages={languages}
              mediaSync={draft.mediaSync ?? false}
              onMediaSyncChange={(next) => updateField('mediaSync', next)}
            />
          </div>

          {draft.moduleType === 'exam' && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-slate-700">{t.common.exam}</p>
                  <p className="text-xs text-slate-500">
                    {t.admin.moduleDetail.examSectionSubtitle}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <span>{t.admin.moduleDetail.passRequirementLabel}</span>
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
        </div>

        {formError && (
          <div className="mt-6 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {formError}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={handlePreview}
            className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            type="button"
          >
            {t.common.preview}
          </button>
          <SaveChangesButton type="button" onClickAction={handleSave} loading={saving} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="border-b border-slate-100 pb-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t.admin.moduleDetail.questionsLabel}
          </p>
          <p className="text-sm text-slate-500">
            {t.admin.moduleDetail.questionsSubtitle}
          </p>
        </div>

        <div className="mt-6">
          <QuestionListEditor
            questions={draft.questions}
            onChange={(next) => updateField('questions', next)}
            languages={languages}
            activeLanguage={activeLanguage}
          />
        </div>

        <div className="mt-6 flex items-center justify-end">
          <SaveChangesButton type="button" onClickAction={handleSave} loading={saving} />
        </div>
      </div>
    </section>
  );
}

const LocaleEditorHeader = ({ label, activeLanguage }: { label: string; activeLanguage: string }) => (
  <div className="flex items-center justify-between">
    <p className="text-sm font-semibold text-slate-700">{label}</p>
    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
      {activeLanguage.toUpperCase()}
    </span>
  </div>
);

const LocaleFieldEditor = ({
  label,
  value,
  onChange,
  activeLanguage,
  multiline,
  variant = 'default',
  containerClassName,
}: {
  label: string;
  value: LocaleStringMap;
  onChange: (next: LocaleStringMap) => void;
  activeLanguage: string;
  multiline?: boolean;
  variant?: 'default' | 'courseInfo';
  containerClassName?: string;
}) => {
  const currentValue = value?.[activeLanguage] ?? '';

  const updateValue = (nextValue: string) => {
    const next: LocaleStringMap = { ...(value ?? {}) };
    next[activeLanguage] = nextValue;
    onChange(next);
  };

  const field = multiline ? (
    <textarea
      value={currentValue}
      onChange={(e) => updateValue(e.target.value)}
      rows={4}
      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
    />
  ) : (
    <input
      value={currentValue}
      onChange={(e) => updateValue(e.target.value)}
      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
    />
  );

  if (variant === 'courseInfo') {
    return (
      <label
        className={`${containerClassName ? `${containerClassName} ` : ''}flex flex-col gap-1 text-sm font-medium text-slate-700`}
      >
        <span className="flex items-center justify-between">
          <span>{label}</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {activeLanguage.toUpperCase()}
          </span>
        </span>
        {field}
      </label>
    );
  }

  return (
    <div className={`${containerClassName ? `${containerClassName} ` : ''}space-y-2`}>
      <LocaleEditorHeader label={label} activeLanguage={activeLanguage} />
      {field}
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
  const { locale } = useLocale();
  const t = getTranslation(locale);
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
  }, [formats, modules, onChange, updateTableActions, value]);

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
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div ref={containerRef} />
      {showTableActions &&
        tableActionsHost &&
        createPortal(
          <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            <span className="mr-2 text-[11px] uppercase tracking-wide text-slate-500">
              {t.admin.moduleDetail.tableLabel}
            </span>
            <button
              type="button"
              onClick={() => handleTableAction('insertRowAbove')}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t.admin.moduleDetail.insertRowAbove}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('insertRowBelow')}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t.admin.moduleDetail.insertRowBelow}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('insertColumnLeft')}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t.admin.moduleDetail.insertColumnLeft}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('insertColumnRight')}
              className="cursor-pointer rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              {t.admin.moduleDetail.insertColumnRight}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('deleteRow')}
              className="cursor-pointer rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              {t.admin.moduleDetail.deleteRow}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('deleteColumn')}
              className="cursor-pointer rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              {t.admin.moduleDetail.deleteColumn}
            </button>
            <button
              type="button"
              onClick={() => handleTableAction('deleteTable')}
              className="cursor-pointer rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              {t.admin.moduleDetail.deleteTable}
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
  const { locale } = useLocale();
  const t = getTranslation(locale);
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
      'link',
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
      <LocaleEditorHeader label={label} activeLanguage={activeLanguage} />
      <QuillEditor
        value={currentValue}
        onChange={handleChange}
        modules={modulesConfig}
        formats={formats}
      />
      <p className="text-xs text-slate-400">
        {t.admin.moduleDetail.richEditorHint}
      </p>
    </div>
  );
};

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
          <Image fill src={item.url} alt="" className="object-contain" sizes="(max-width: 768px) 100vw, 33vw" />
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
  isTarget,
}: {
  item: ModuleMediaItem;
  onRemove: () => void;
  onCaptionChange: (caption: string) => void;
  isTarget: boolean;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: item.id });
  const [mediaError, setMediaError] = useState(false);
  useEffect(() => {
    setMediaError(false);
  }, [item.url]);

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
            <Image
              fill
              src={item.url}
              alt={t.admin.moduleDetail.previewMediaAlt}
              className="object-contain"
              sizes="(max-width: 768px) 100vw, 33vw"
              onError={() => setMediaError(true)}
            />
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
            <button
              type="button"
              onClick={() => window.open(item.url, '_blank')}
              disabled={mediaError}
              title={mediaError ? t.admin.moduleDetail.fileUnavailable : undefined}
              className="cursor-pointer rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t.common.open}
            </button>
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

const LocaleMediaEditor = ({
  label,
  media,
  onChange,
  activeLanguage,
  courseId,
  moduleId,
  languages,
  mediaSync,
  onMediaSyncChange,
}: {
  label: string;
  media: LocaleModuleMediaMap;
  onChange: (next: LocaleModuleMediaMap) => void;
  activeLanguage: string;
  courseId: string;
  moduleId: string;
  languages: string[];
  mediaSync: boolean;
  onMediaSyncChange: (next: boolean) => void;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const items = useMemo(() => media?.[activeLanguage] ?? [], [media, activeLanguage]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState<'image' | 'video' | 'document' | null>(null);
  const [reuseSourceLang, setReuseSourceLang] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const langsWithMedia = useMemo(
    () => languages.filter((lang) => lang !== activeLanguage && (media[lang] ?? []).length > 0),
    [languages, activeLanguage, media],
  );

  const effectiveReuseSource = langsWithMedia.includes(reuseSourceLang)
    ? reuseSourceLang
    : langsWithMedia[0] ?? '';

  const applySyncFromBase = useCallback(
    (baseItems: ModuleMediaItem[], currentMedia: LocaleModuleMediaMap): LocaleModuleMediaMap => {
      const nextMedia: LocaleModuleMediaMap = {};
      languages.forEach((lang) => {
        const captionMap = new Map((currentMedia[lang] ?? []).map((item) => [item.id, item.caption]));
        nextMedia[lang] = baseItems.map((item) => {
          const result = { ...item };
          const caption = captionMap.get(item.id);
          if (caption) result.caption = caption;
          else delete result.caption;
          return result;
        });
      });
      return nextMedia;
    },
    [languages],
  );

  const updateList = useCallback(
    (next: ModuleMediaItem[]) => {
      if (mediaSync) {
        onChange(applySyncFromBase(next, media));
      } else {
        onChange({ ...(media ?? {}), [activeLanguage]: next });
      }
    },
    [media, activeLanguage, onChange, mediaSync, applySyncFromBase],
  );

  type SyncConflictItem = {
    lang: string;
    extraItems: ModuleMediaItem[];
    missingCount: number;
  };

  const [pendingSyncEnable, setPendingSyncEnable] = useState<{
    baseItems: ModuleMediaItem[];
    conflicts: SyncConflictItem[];
  } | null>(null);

  const syncConflictUniqueMissing = useMemo(() => {
    if (!pendingSyncEnable) return [];
    const seen = new Map<string, { item: ModuleMediaItem; fromLangs: string[] }>();
    pendingSyncEnable.conflicts.forEach(({ lang, extraItems }) => {
      extraItems.forEach((item) => {
        if (seen.has(item.id)) {
          seen.get(item.id)!.fromLangs.push(lang);
        } else {
          seen.set(item.id, { item, fromLangs: [lang] });
        }
      });
    });
    return Array.from(seen.values());
  }, [pendingSyncEnable?.conflicts]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncConflictBaseIds = useMemo(
    () => new Set((pendingSyncEnable?.baseItems ?? []).map((i) => i.id)),
    [pendingSyncEnable?.baseItems],
  );

  const syncConflictConsequences = useMemo(() => {
    if (!pendingSyncEnable) return [];
    const baseIds = new Set(pendingSyncEnable.baseItems.map((i) => i.id));
    return languages
      .filter((lang) => lang !== activeLanguage)
      .map((lang) => {
        const langItems = media[lang] ?? [];
        const langIds = new Set(langItems.map((i) => i.id));
        const willGain = pendingSyncEnable.baseItems.filter((i) => !langIds.has(i.id)).length;
        const willLose = langItems.filter((i) => !baseIds.has(i.id)).length;
        return { lang, willGain, willLose };
      })
      .filter(({ willGain, willLose }) => willGain > 0 || willLose > 0);
  }, [pendingSyncEnable?.baseItems, languages, activeLanguage, media]); // eslint-disable-line react-hooks/exhaustive-deps

  const [pendingSyncDelete, setPendingSyncDelete] = useState<{
    id: string;
    url: string;
  } | null>(null);

  const confirmSyncDelete = () => {
    if (!pendingSyncDelete) return;
    const { id, url } = pendingSyncDelete;
    const nextMedia: LocaleModuleMediaMap = {};
    languages.forEach((lang) => {
      nextMedia[lang] = (media[lang] ?? []).filter((item) => item.id !== id);
    });
    onChange(nextMedia);
    void maybeDeleteUploadedFile(url);
    setPendingSyncDelete(null);
  };

  const [expandedConflictInfoIds, setExpandedConflictInfoIds] = useState<Set<string>>(new Set());

  const closeSyncConflictDialog = () => {
    setPendingSyncEnable(null);
    setExpandedConflictInfoIds(new Set());
  };


  const handleSyncToggle = () => {
    if (mediaSync) {
      onMediaSyncChange(false);
      return;
    }

    const currentIds = new Set(items.map((i) => i.id));
    const conflicts: SyncConflictItem[] = [];
    languages.forEach((lang) => {
      if (lang === activeLanguage) return;
      const langItems = media[lang] ?? [];
      const langIds = new Set(langItems.map((i) => i.id));
      const extraItems = langItems.filter((i) => !currentIds.has(i.id));
      const missingCount = items.filter((i) => !langIds.has(i.id)).length;
      if (extraItems.length > 0 || missingCount > 0) {
        conflicts.push({ lang, extraItems, missingCount });
      }
    });

    if (conflicts.length > 0) {
      setPendingSyncEnable({ baseItems: [...items], conflicts });
    } else {
      onChange(applySyncFromBase(items, media));
      onMediaSyncChange(true);
    }
  };

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<ModuleMediaItem | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

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
    updateList(swapped);
  }, [items, updateList]);

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    setActiveItem(null);
    setOverId(null);
  }, []);

  const [pendingRemove, setPendingRemove] = useState<{
    id: string;
    url: string;
    otherLangs: string[];
  } | null>(null);

  const handleRemove = (id: string) => {
    const target = items.find((item) => item.id === id);
    if (!target) return;

    if (mediaSync) {
      setPendingSyncDelete({ id, url: target.url });
      return;
    }

    const otherLangsWithItem = languages.filter(
      (lang) => lang !== activeLanguage && (media[lang] ?? []).some((item) => item.id === id),
    );
    if (otherLangsWithItem.length > 0) {
      setPendingRemove({ id, url: target.url, otherLangs: otherLangsWithItem });
    } else {
      updateList(items.filter((item) => item.id !== id));
      void maybeDeleteUploadedFile(target.url);
    }
  };

  const confirmRemoveFromAll = () => {
    if (!pendingRemove) return;
    const { id, url, otherLangs } = pendingRemove;
    const nextMedia: LocaleModuleMediaMap = { ...media };
    [activeLanguage, ...otherLangs].forEach((lang) => {
      nextMedia[lang] = (nextMedia[lang] ?? []).filter((item) => item.id !== id);
    });
    onChange(nextMedia);
    void maybeDeleteUploadedFile(url);
    setPendingRemove(null);
  };

  const confirmRemoveFromActive = () => {
    if (!pendingRemove) return;
    updateList(items.filter((item) => item.id !== pendingRemove.id));
    setPendingRemove(null);
  };

  const handleReuse = (requireConfirm: boolean) => {
    const sourceLang = effectiveReuseSource;
    if (!sourceLang) return;
    if (requireConfirm) {
      const confirmed = window.confirm(
        t.admin.moduleDetail.mediaReuseConfirm(sourceLang.toUpperCase()),
      );
      if (!confirmed) return;
    }
    updateList([...(media[sourceLang] ?? [])]);
  };

  const reuseInfo = useMemo(() => {
    if (!effectiveReuseSource) return { missing: 0, total: 0 };
    const sourceItems = media[effectiveReuseSource] ?? [];
    if (sourceItems.length === 0) return { missing: 0, total: 0 };
    const activeIds = new Set(items.map((i) => i.id));
    const missing = sourceItems.filter((s) => !activeIds.has(s.id)).length;
    return { missing, total: sourceItems.length };
  }, [effectiveReuseSource, media, items]);

  const alreadyReused = reuseInfo.total > 0 && reuseInfo.missing === 0;

  const reuseButtonLabel = alreadyReused
    ? t.admin.moduleDetail.mediaAlreadyReused
    : reuseInfo.missing > 0 && reuseInfo.missing < reuseInfo.total
      ? t.admin.moduleDetail.mediaReuseMissing(reuseInfo.missing)
      : t.admin.moduleDetail.mediaReuseFrom;


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
      alert(t.admin.moduleDetail.uploadFileError);
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="space-y-3">
      <LocaleEditorHeader label={label} activeLanguage={activeLanguage} />
      {pendingRemove && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPendingRemove(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-slate-900">
              {t.admin.moduleDetail.mediaRemovePendingTitle}
            </p>
            <p className="text-sm text-slate-600">
              {t.admin.moduleDetail.mediaRemovePendingMessage(
                pendingRemove.otherLangs.map((l) => l.toUpperCase()).join(', '),
              )}
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={confirmRemoveFromAll}
                className="cursor-pointer rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:border-red-300 hover:bg-red-50 text-left"
              >
                {t.admin.moduleDetail.mediaRemoveFromAll}
              </button>
              <button
                type="button"
                onClick={confirmRemoveFromActive}
                className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 text-left"
              >
                {t.admin.moduleDetail.mediaRemoveFromActiveOnly(activeLanguage.toUpperCase())}
              </button>
              <button
                type="button"
                onClick={() => setPendingRemove(null)}
                className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 text-left"
              >
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
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
      {pendingSyncEnable && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-24"
          onClick={closeSyncConflictDialog}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900">
                {t.admin.moduleDetail.mediaSyncConflictTitle}
              </p>
              <p className="text-sm text-slate-500">
                {syncConflictUniqueMissing.length === 0
                  ? t.admin.moduleDetail.mediaSyncConflictDescCurrentHasMore
                  : t.admin.moduleDetail.mediaSyncConflictDesc(
                      activeLanguage.toUpperCase(),
                      syncConflictUniqueMissing.length,
                    )}
              </p>
            </div>
            {syncConflictUniqueMissing.length > 0 && (
              <div className="mt-4 space-y-2">
                {syncConflictUniqueMissing.map(({ item, fromLangs }) => {
                  const added = syncConflictBaseIds.has(item.id);
                  const typeLabel =
                    item.type === 'video'
                      ? t.admin.moduleDetail.mediaTypeVideo
                      : item.type === 'document'
                        ? t.admin.moduleDetail.mediaTypeDocument
                        : t.admin.moduleDetail.mediaTypeImage;
                  const fileName = getFileNameFromUrl(item.url);
                  const langCaptions = fromLangs
                    .map((lang) => ({
                      lang,
                      caption: media[lang]?.find((i) => i.id === item.id)?.caption ?? '',
                    }))
                    .filter(({ caption }) => caption.length > 0);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-3"
                    >
                      {langCaptions.length > 0 && (
                        <div className="group relative shrink-0">
                          <div className="flex h-5 w-5 cursor-default items-center justify-center rounded-full border border-slate-300 text-xs font-bold text-slate-400 transition hover:border-slate-500 hover:text-slate-600">
                            i
                          </div>
                          <div className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden min-w-max rounded-xl border border-slate-200 bg-white p-3 shadow-lg group-hover:block">
                            <div className="space-y-1">
                              {langCaptions.map(({ lang, caption }) => (
                                <p key={lang} className="text-xs text-slate-500">
                                  <span className="font-semibold">{lang.toUpperCase()}:</span>{' '}
                                  {caption}
                                </p>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-700">
                          {typeLabel}
                          <span className="font-normal text-slate-500"> – {fileName}</span>
                        </p>
                        <p className="text-xs text-slate-400">
                          {t.admin.moduleDetail.mediaSyncConflictFoundIn}{' '}
                          {fromLangs.map((l) => l.toUpperCase()).join(', ')}
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={added}
                        onClick={() => {
                          setPendingSyncEnable((prev) => {
                            if (!prev) return prev;
                            if (added) {
                              return { ...prev, baseItems: prev.baseItems.filter((i) => i.id !== item.id) };
                            }
                            return { ...prev, baseItems: [...prev.baseItems, item] };
                          });
                        }}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none ${
                          added ? 'bg-emerald-500' : 'bg-slate-200'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                            added ? 'translate-x-[18px]' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
                {syncConflictUniqueMissing.every(({ item }) => syncConflictBaseIds.has(item.id)) ? (
                  <button
                    type="button"
                    onClick={() => {
                      const uniqueIds = new Set(syncConflictUniqueMissing.map(({ item }) => item.id));
                      setPendingSyncEnable((prev) =>
                        prev ? { ...prev, baseItems: prev.baseItems.filter((i) => !uniqueIds.has(i.id)) } : prev,
                      );
                    }}
                    className="w-full cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  >
                    {t.admin.moduleDetail.mediaSyncConflictRemoveAll(syncConflictUniqueMissing.length)}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const toAdd = syncConflictUniqueMissing
                        .filter(({ item }) => !syncConflictBaseIds.has(item.id))
                        .map(({ item }) => item);
                      setPendingSyncEnable((prev) =>
                        prev ? { ...prev, baseItems: [...prev.baseItems, ...toAdd] } : prev,
                      );
                    }}
                    className="w-full cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  >
                    {t.admin.moduleDetail.mediaSyncConflictAddAll(
                      syncConflictUniqueMissing.filter(({ item }) => !syncConflictBaseIds.has(item.id)).length,
                    )}
                  </button>
                )}
              </div>
            )}
            {syncConflictConsequences.length > 0 && (
              <div className="mt-6 space-y-1.5 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-slate-700">
                    {t.admin.moduleDetail.mediaSyncConflictConsequencesTitle}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {t.admin.moduleDetail.mediaSyncConflictConsequencesHint(activeLanguage.toUpperCase())}
                  </p>
                </div>
                <div className="space-y-1 pt-1">
                  {syncConflictConsequences.map(({ lang, willGain, willLose }) => {
                    const label =
                      willGain > 0 && willLose > 0
                        ? t.admin.moduleDetail.mediaSyncConflictLangGainAndLose(lang.toUpperCase(), willGain, willLose)
                        : willGain > 0
                          ? t.admin.moduleDetail.mediaSyncConflictLangWillGain(lang.toUpperCase(), willGain)
                          : t.admin.moduleDetail.mediaSyncConflictLangWillLose(lang.toUpperCase(), willLose);
                    const isLosing = willLose > 0;
                    return (
                      <p
                        key={lang}
                        className={`text-xs font-medium ${isLosing ? 'text-amber-600' : 'text-emerald-600'}`}
                      >
                        {label}
                      </p>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="mt-6 text-xs font-medium text-slate-600">
              {t.admin.moduleDetail.mediaSyncConflictWillSync(pendingSyncEnable.baseItems.length)}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  onChange(applySyncFromBase(pendingSyncEnable.baseItems, media));
                  onMediaSyncChange(true);
                  closeSyncConflictDialog();
                }}
                className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 text-left"
              >
                {t.admin.moduleDetail.mediaSyncConflictProceed(pendingSyncEnable.baseItems.length)}
              </button>
              <button
                type="button"
                onClick={closeSyncConflictDialog}
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
                      {lang.toUpperCase()} ({t.admin.moduleDetail.mediaReuseElements((media[lang] ?? []).length)})
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
                  onCaptionChange={(caption) => {
                    updateList(
                      items.map((i) => {
                        if (i.id !== item.id) return i;
                        const next = { ...i };
                        if (caption) {
                          next.caption = caption;
                        } else {
                          delete next.caption;
                        }
                        return next;
                      }),
                    );
                  }}
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
                    {lang.toUpperCase()} ({t.admin.moduleDetail.mediaReuseElements((media[lang] ?? []).length)})
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
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const [minimizedIds, setMinimizedIds] = useState<Set<string>>(
    () => new Set(questions.map((question) => question.id)),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const addQuestion = () => {
    onChange([...questions, createEmptyQuestion(languages)]);
  };

  const updateQuestion = (index: number, question: CourseQuestion) => {
    const next = [...questions];
    next[index] = question;
    onChange(next);
  };

  const removeQuestion = (index: number) => {
    const removed = questions[index];
    if (removed) {
      setMinimizedIds((prev) => {
        const next = new Set(prev);
        next.delete(removed.id);
        return next;
      });
    }
    onChange(questions.filter((_, idx) => idx !== index));
  };

  const duplicateQuestion = (index: number) => {
    const source = questions[index];
    if (!source) {
      return;
    }

    const alternativeIdMap = new Map<string, string>();
    const duplicatedAlternatives = source.alternatives.map((alternative) => {
      const duplicatedId = generateId();
      alternativeIdMap.set(alternative.id, duplicatedId);
      return {
        ...alternative,
        id: duplicatedId,
        altText: { ...(alternative.altText ?? {}) },
      };
    });

    const sourceCorrectIds = Array.isArray(source.correctAnswerIds)
      ? source.correctAnswerIds
      : source.correctAnswerId
        ? [source.correctAnswerId]
        : [];

    const duplicatedCorrectIds = sourceCorrectIds
      .map((id) => alternativeIdMap.get(id) ?? id)
      .filter((id, idx, arr) => arr.indexOf(id) === idx)
      .filter((id) => duplicatedAlternatives.some((alternative) => alternative.id === id));

    const fallbackCorrectId = duplicatedAlternatives[0]?.id;
    const nextCorrectIds =
      duplicatedCorrectIds.length > 0
        ? duplicatedCorrectIds
        : fallbackCorrectId
          ? [fallbackCorrectId]
          : [];

    const duplicatedQuestion: CourseQuestion = {
      ...source,
      id: generateId(),
      title: { ...(source.title ?? {}) },
      contentText: { ...(source.contentText ?? {}) },
      alternatives: duplicatedAlternatives,
      correctAnswerIds: nextCorrectIds,
      correctAnswerId: nextCorrectIds[0],
    };

    const next = [...questions];
    next.splice(index + 1, 0, duplicatedQuestion);
    onChange(next);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) {
      return;
    }
    const oldIndex = questions.findIndex((question) => question.id === event.active.id);
    const newIndex = questions.findIndex((question) => question.id === event.over?.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      return;
    }
    onChange(arrayMove(questions, oldIndex, newIndex));
  };

  const toggleMinimized = (id: string) => {
    setMinimizedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const allMinimized = questions.length > 0 && questions.every((q) => minimizedIds.has(q.id));

  const handleToggleAll = () => {
    if (allMinimized) {
      setMinimizedIds(new Set());
    } else {
      setMinimizedIds(new Set(questions.map((q) => q.id)));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">
          {t.admin.moduleDetail.questionsLabel}{' '}
          <span className="font-normal text-slate-500">
            ({questions.length} {t.admin.moduleDetail.questionsLabel.toLowerCase()})
          </span>
        </p>
        <div className="flex items-center gap-2">
          {questions.length > 0 && (
            <button
              type="button"
              onClick={handleToggleAll}
              className="cursor-pointer rounded-xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
            >
              {allMinimized ? t.admin.moduleDetail.showAllQuestions : t.admin.moduleDetail.hideAllQuestions}
            </button>
          )}
          <button
            type="button"
            onClick={addQuestion}
            className="cursor-pointer rounded-xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
          >
            {t.admin.moduleDetail.addQuestion}
          </button>
        </div>
      </div>
      {questions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
          {t.admin.moduleDetail.noQuestionsYet}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext
            items={questions.map((question) => question.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-4">
              {questions.map((question, index) => (
                <SortableQuestionEditor
                  key={question.id}
                  id={question.id}
                  index={index}
                  question={question}
                  onChange={(next) => updateQuestion(index, next)}
                  onDuplicate={() => duplicateQuestion(index)}
                  onRemove={() => removeQuestion(index)}
                  languages={languages}
                  activeLanguage={activeLanguage}
                  isMinimized={minimizedIds.has(question.id)}
                  onToggleMinimized={() => toggleMinimized(question.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
};

const SortableQuestionEditor = ({
  id,
  question,
  onChange,
  onDuplicate,
  onRemove,
  languages,
  activeLanguage,
  index,
  isMinimized,
  onToggleMinimized,
}: {
  id: UniqueIdentifier;
  question: CourseQuestion;
  onChange: (next: CourseQuestion) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  languages: string[];
  activeLanguage: string;
  index: number;
  isMinimized: boolean;
  onToggleMinimized: () => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.75 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <QuestionEditor
        index={index}
        question={question}
        onChange={onChange}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
        languages={languages}
        activeLanguage={activeLanguage}
        dragHandleProps={{ attributes, listeners }}
        isMinimized={isMinimized}
        onToggleMinimized={onToggleMinimized}
      />
    </div>
  );
};

const SortableQuestionAlternative = ({
  id,
  alternative,
  idx,
  question,
  currentCorrectIds,
  onToggleCorrect,
  onRemove,
  onUpdate,
  activeLanguage,
}: {
  id: UniqueIdentifier;
  alternative: CourseQuestionAlternative;
  idx: number;
  question: CourseQuestion;
  currentCorrectIds: string[];
  onToggleCorrect: (altId: string) => void;
  onRemove: (altId: string) => void;
  onUpdate: (altId: string, map: LocaleStringMap) => void;
  activeLanguage: string;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.75 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-xl border border-slate-200 bg-slate-50 p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <DragHandle attributes={attributes} listeners={listeners} />
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t.admin.moduleDetail.alternativeLabel(idx + 1)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={currentCorrectIds.includes(alternative.id)}
              onChange={() => onToggleCorrect(alternative.id)}
            />
            {t.admin.moduleDetail.correctAnswer}
          </label>
          {question.alternatives.length > 2 && (
            <button
              type="button"
              onClick={() => onRemove(alternative.id)}
              className="cursor-pointer rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50"
            >
              {t.admin.moduleDetail.removeAlternative}
            </button>
          )}
        </div>
      </div>

      <LocaleFieldEditor
        label={t.admin.moduleDetail.alternativeText}
        value={alternative.altText}
        onChange={(next) => onUpdate(alternative.id, next)}
        activeLanguage={activeLanguage}
      />
    </div>
  );
};

type DragHandleProps = {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
};

const QuestionEditor = ({
  question,
  onChange,
  onDuplicate,
  onRemove,
  languages,
  activeLanguage,
  index,
  dragHandleProps,
  isMinimized,
  onToggleMinimized,
}: {
  question: CourseQuestion;
  onChange: (next: CourseQuestion) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  languages: string[];
  activeLanguage: string;
  index: number;
  dragHandleProps?: {
    attributes: DragHandleProps['attributes'];
    listeners: DragHandleProps['listeners'];
  };
  isMinimized: boolean;
  onToggleMinimized: () => void;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const alternativeSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

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

  const handleAlternativeDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) {
      return;
    }
    const oldIndex = question.alternatives.findIndex((alt) => alt.id === event.active.id);
    const newIndex = question.alternatives.findIndex((alt) => alt.id === event.over?.id);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      return;
    }
    const reorderedAlternatives = arrayMove(question.alternatives, oldIndex, newIndex);
    const orderedCorrectIds = reorderedAlternatives
      .map((alt) => alt.id)
      .filter((id) => currentCorrectIds.includes(id));
    onChange({
      ...question,
      alternatives: reorderedAlternatives,
      correctAnswerIds: orderedCorrectIds,
      correctAnswerId: orderedCorrectIds[0],
    });
  };

  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      {/* Header */}
      <div className={`flex items-start justify-between p-4 hover:bg-slate-100 ${isMinimized ? 'rounded-2xl' : 'rounded-t-2xl'}`}>
        <div className="flex items-start gap-2">
          {dragHandleProps && (
            <DragHandle
              attributes={dragHandleProps.attributes}
              listeners={dragHandleProps.listeners}
              className="mt-0.5"
            />
          )}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t.admin.moduleDetail.questionIndex(index + 1)}
            </p>
            <p className="text-xs text-slate-500">
              {t.admin.moduleDetail.alternativeCount(question.alternatives.length)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleMinimized}
            className="cursor-pointer rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-100"
            title={isMinimized ? t.admin.moduleDetail.showDetails : t.admin.moduleDetail.hideDetails}
          >
            {isMinimized ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M9.47 6.47a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 1 1-1.06 1.06L10 8.06l-3.72 3.72a.75.75 0 0 1-1.06-1.06l4.25-4.25Z" clipRule="evenodd" />
              </svg>
            )}
          </button>
          <DuplicateButton
            onClick={onDuplicate}
            className="ml-2"
          >{t.common.duplicate}</DuplicateButton>
          <button
            type="button"
            onClick={onRemove}
            className="cursor-pointer rounded-lg border border-red-200 px-3 py-1 text-xs font-semibold text-red-600 hover:border-red-300 hover:bg-red-50"
          >
            {t.admin.moduleDetail.removeQuestion}
          </button>
        </div>
      </div>

      {/* Collapsible body */}
      {!isMinimized && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-4 space-y-4">
          <LocaleFieldEditor
            label={t.admin.moduleDetail.questionText}
            value={question.contentText}
            onChange={(next) => updateLocaleField('contentText', next)}
            activeLanguage={activeLanguage}
            multiline
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">{t.admin.moduleDetail.answersLabel}</p>
              <button
                type="button"
                onClick={addAlternative}
                className="cursor-pointer rounded-xl border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50"
              >
                {t.admin.moduleDetail.addAlternative}
              </button>
            </div>

            <DndContext sensors={alternativeSensors} onDragEnd={handleAlternativeDragEnd}>
              <SortableContext
                items={question.alternatives.map((alternative) => alternative.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {question.alternatives.map((alternative, idx) => (
                    <SortableQuestionAlternative
                      key={alternative.id}
                      id={alternative.id}
                      alternative={alternative}
                      idx={idx}
                      question={question}
                      currentCorrectIds={currentCorrectIds}
                      onToggleCorrect={toggleCorrectAnswer}
                      onRemove={removeAlternative}
                      onUpdate={updateAlternative}
                      activeLanguage={activeLanguage}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </div>
        </div>
      )}
    </div>
  );
};
