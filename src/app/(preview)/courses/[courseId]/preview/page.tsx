'use client';

import { use, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';

import { useCourse } from '@/hooks/useCourse';
import { useCourseModules } from '@/hooks/useCourseModules';
import { useCourseProgress } from '@/hooks/useCourseProgress';
import type { LocaleStringArrayMap, LocaleStringMap } from '@/types/course';
import { getLocalizedMediaItems } from '@/utils/media';

const getPreferredLocale = (available: string[]): string => {
  if (!available.length) return 'no';
  const browserLang =
    typeof window !== 'undefined'
      ? window.navigator.language.slice(0, 2).toLowerCase()
      : 'no';
  const candidates = [browserLang, 'no', 'en'];
  for (const candidate of candidates) {
    if (available.includes(candidate)) {
      return candidate;
    }
  }
  return available[0];
};

const getLocalizedValue = (
  value: LocaleStringMap | undefined,
  locale: string,
): string => {
  if (!value) return '';
  return (
    value[locale] ??
    value.no ??
    value.en ??
    Object.values(value).find((entry) => entry?.trim()) ??
    ''
  );
};

const getLocalizedList = (
  value: LocaleStringArrayMap | undefined,
  locale: string,
): string[] => {
  if (!value) return [];
  return (
    value[locale] ??
    value.no ??
    value.en ??
    Object.values(value).find((entry) => entry && entry.length) ??
    []
  );
};

const getModulesHeading = (locale: string): string => {
  switch (locale) {
    case 'en':
      return 'Modules in this course';
    case 'it':
      return 'Moduli del corso';
    case 'sv':
      return 'Moduler i kursen';
    default:
      return 'Emner i kurset';
  }
};

const getCourseProgressLabel = (locale: string): string => {
  switch (locale) {
    case 'en':
      return 'Course progress';
    case 'it':
      return 'Progresso del corso';
    case 'sv':
      return 'Kursprogression';
    default:
      return 'Kursfremdrift';
  }
};

const getCourseProgressSummary = (
  locale: string,
  completed: number,
  total: number,
): string => {
  if (!total) {
    switch (locale) {
      case 'en':
        return 'No modules available yet.';
      case 'it':
        return 'Nessun modulo disponibile.';
      case 'sv':
        return 'Inga moduler tillgängliga ännu.';
      default:
        return 'Ingen emner tilgjengelig ennå.';
    }
  }

  switch (locale) {
    case 'en':
      return `${completed} of ${total} modules completed`;
    case 'it':
      return `${completed} di ${total} moduli completati`;
    case 'sv':
      return `${completed} av ${total} moduler slutförda`;
    default:
      return `${completed} av ${total} emner fullført`;
  }
};

const getModuleStatusLabel = (locale: string, isComplete: boolean): string => {
  if (isComplete) {
    switch (locale) {
      case 'en':
        return 'Completed';
      case 'it':
        return 'Completato';
      case 'sv':
        return 'Slutförd';
      default:
        return 'Fullført';
    }
  }

  switch (locale) {
    case 'en':
      return 'Not started';
    case 'it':
      return 'Non iniziato';
    case 'sv':
      return 'Inte påbörjad';
    default:
      return 'Ikke påbegynt';
  }
};

const getLastUpdatedLabel = (locale: string): string => {
  switch (locale) {
    case 'en':
      return 'Last updated';
    case 'it':
      return 'Ultimo aggiornamento';
    case 'sv':
      return 'Senast uppdaterad';
    default:
      return 'Sist oppdatert';
  }
};

const getDateLocale = (locale: string): string => {
  switch (locale) {
    case 'en':
      return 'en-GB';
    case 'it':
      return 'it-IT';
    case 'sv':
      return 'sv-SE';
    default:
      return 'nb-NO';
  }
};

export default function CoursePreviewPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = use(params);
  const router = useRouter();
  const { course, loading, error } = useCourse(courseId);
  const {
    modules,
    loading: modulesLoading,
    error: modulesError,
  } = useCourseModules(courseId);

  // modules are already sorted by useCourseModules hook
  const sortedModules = modules;

  const availableLocales = useMemo(() => {
    const set = new Set<string>();
    if (course?.title) Object.keys(course.title).forEach((lang) => set.add(lang));
    if (course?.description)
      Object.keys(course.description).forEach((lang) => set.add(lang));
    sortedModules.forEach((module) => {
      if (module.title) Object.keys(module.title).forEach((lang) => set.add(lang));
      if (module.summary) Object.keys(module.summary).forEach((lang) => set.add(lang));
      if (module.body) Object.keys(module.body).forEach((lang) => set.add(lang));
    if (module.media) Object.keys(module.media).forEach((lang) => set.add(lang));
      Object.keys(module.videoUrls ?? {}).forEach((lang) => set.add(lang));
      Object.keys(module.imageUrls ?? {}).forEach((lang) => set.add(lang));
    });
    return Array.from(set);
  }, [course, sortedModules]);

  const locale = useMemo(
    () => getPreferredLocale(availableLocales),
    [availableLocales],
  );

  const description = getLocalizedValue(course?.description, locale);
  const updatedAt = course?.updatedAt ?? course?.createdAt;
  const { completedModules, loading: progressLoading } = useCourseProgress(courseId);
  const totalModules = sortedModules.length;
  const completedCount = sortedModules.filter((module) =>
    completedModules.includes(module.id),
  ).length;
  const courseProgressPercent = totalModules
    ? Math.round((completedCount / totalModules) * 100)
    : 0;
  const progressSummary = progressLoading
    ? '…'
    : getCourseProgressSummary(locale, completedCount, totalModules);

  const nextModuleId = useMemo(() => {
    if (!sortedModules.length) return null;
    const pending = sortedModules.find(
      (module) => !completedModules.includes(module.id),
    );
    return (pending ?? sortedModules[0])?.id ?? null;
  }, [sortedModules, completedModules]);

  const handleOpenModule = useCallback(
    (moduleId: string) => {
      router.push(`/courses/${courseId}/modules/${moduleId}/preview?lang=${locale}`);
    },
    [courseId, locale, router],
  );

  const handleStartCourse = () => {
    if (!nextModuleId) return;
    router.push(`/courses/${courseId}/modules/${nextModuleId}/preview?lang=${locale}`);
  };

  const startButtonLabel = completedCount > 0 ? 'Fortsett kurs' : 'Start kurs';

  if (loading || modulesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Laster kurs …
      </div>
    );
  }

  if (error || modulesError || !course) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-red-100 bg-red-50 px-6 py-4 text-sm text-red-600">
          {error ?? modulesError ?? 'Kunne ikke hente kurset.'}
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-4 pb-12 pt-10 md:px-8">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {course.courseImageUrl ? (
          <div className="relative h-64 w-full overflow-hidden sm:h-80 md:h-96">
            <img
              src={course.courseImageUrl}
              alt={getLocalizedValue(course.title, locale) || courseId}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center bg-gradient-to-br from-slate-200 to-slate-100 text-slate-500 sm:h-64 md:h-72">
            Ingen forsidebilde lastet opp
          </div>
        )}
        <div className="flex flex-col gap-4 px-6 py-8 md:px-10">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900 sm:text-4xl">
              {getLocalizedValue(course.title, locale) || 'Kurs'}
            </h1>
            {updatedAt && (
              <p className="mt-1 text-xs text-slate-400">
                {getLastUpdatedLabel(locale)}{' '}
                {updatedAt.toLocaleString(getDateLocale(locale))}
              </p>
            )}
          </div>
          {description && (
            <p className="text-base text-slate-600 whitespace-pre-line">{description}</p>
          )}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
              <span>{getCourseProgressLabel(locale)}</span>
              <span>{progressLoading ? '…' : `${courseProgressPercent}%`}</span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-slate-900 transition-all"
                style={{ width: `${courseProgressPercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">{progressSummary}</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-sm md:px-10">
        <h2 className="text-2xl font-semibold text-slate-900">
          {getModulesHeading(locale)}
        </h2>
        <div className="mt-6 space-y-4">
          {sortedModules.map((module, index) => {
            const isCompleted = completedModules.includes(module.id);
            const moduleProgressPercent = isCompleted ? 100 : 0;
            const localizedMedia = getLocalizedMediaItems(module.media, locale);
            const videoCount = localizedMedia.length
              ? localizedMedia.filter((item) => item.type === 'video').length
              : getLocalizedList(module.videoUrls, locale).length;
            return (
              <button
                key={module.id}
                type="button"
                onClick={() => handleOpenModule(module.id)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Emne {index + 1}
                </p>
                <h3 className="text-lg font-semibold text-slate-900">
                  {getLocalizedValue(module.title, locale) || 'Uten tittel'}
                </h3>
                {getLocalizedValue(module.summary, locale) && (
                  <p className="text-sm text-slate-600">
                    {getLocalizedValue(module.summary, locale)}
                  </p>
                )}
                {videoCount > 0 && (
                  <p className="mt-2 text-xs text-slate-400">
                    Inneholder {videoCount} video{videoCount > 1 ? 'er' : ''}
                  </p>
                )}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                    <span>{getModuleStatusLabel(locale, isCompleted)}</span>
                    <span>{moduleProgressPercent}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isCompleted ? 'bg-emerald-500' : 'bg-slate-400'
                      }`}
                      style={{ width: `${moduleProgressPercent}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-8 flex justify-center">
          <button
            onClick={handleStartCourse}
            disabled={!nextModuleId}
            className="w-full max-w-xl rounded-2xl bg-slate-900 px-8 py-3 text-center text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {startButtonLabel}
          </button>
        </div>
      </section>
    </main>
  );
}
