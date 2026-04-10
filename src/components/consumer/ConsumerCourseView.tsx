'use client';
/* eslint-disable @next/next/no-img-element */

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { useCourseProgress } from '@/hooks/useCourseProgress';
import type { Course } from '@/types/course';
import type { CourseModule } from '@/types/course';
import {
  getDateLocale,
  getLocalizedList,
  getLocalizedValue,
  getPreferredLocale,
} from '@/utils/localization';
import { getLocalizedMediaItems } from '@/utils/media';
import { getTranslation } from '@/utils/translations';

interface ConsumerCourseViewProps {
  course: Course;
  modules: CourseModule[];
  loading?: boolean;
  error?: string | null;
  basePath?: string; // e.g. '/courses' or '/my-courses'
}

export default function ConsumerCourseView({
  course,
  modules,
  loading = false,
  error = null,
  basePath = '/my-courses',
}: ConsumerCourseViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedLang = searchParams.get('lang');

  const availableLocales = useMemo(() => {
    const set = new Set<string>();
    if (course?.title) Object.keys(course.title).forEach((lang) => set.add(lang));
    if (course?.description)
      Object.keys(course.description).forEach((lang) => set.add(lang));
    modules.forEach((module) => {
      if (module.title) Object.keys(module.title).forEach((lang) => set.add(lang));
      if (module.summary) Object.keys(module.summary).forEach((lang) => set.add(lang));
      if (module.body) Object.keys(module.body).forEach((lang) => set.add(lang));
      if (module.media) Object.keys(module.media).forEach((lang) => set.add(lang));
      Object.keys(module.videoUrls ?? {}).forEach((lang) => set.add(lang));
      Object.keys(module.imageUrls ?? {}).forEach((lang) => set.add(lang));
    });
    return Array.from(set);
  }, [course, modules]);

  const { locale: preferredLocale, setLocale } = useLocale();

  const locale = useMemo(
    () => getPreferredLocale(availableLocales, preferredLocale),
    [availableLocales, preferredLocale],
  );

  useEffect(() => {
    if (requestedLang) setLocale(requestedLang);
  }, [requestedLang, setLocale]);

  const t = getTranslation(locale);
  const { firebaseUser } = useAuth();
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const description = getLocalizedValue(course?.description, locale);
  const updatedAt = course?.updatedAt ?? course?.createdAt;
  const { completedModules, loading: progressLoading, moduleAnsweredCounts } = useCourseProgress(course.id);
  const totalModules = modules.length;
  const completedCount = modules.filter((module) =>
    completedModules.includes(module.id),
  ).length;
  const isCourseCompleted = totalModules > 0 && completedCount === totalModules;
  const courseProgressPercent = totalModules
    ? Math.round((completedCount / totalModules) * 100)
    : 0;
  
  const progressSummary = progressLoading
    ? '…'
    : totalModules === 0 
      ? t.courses.noModulesYet
      : t.courses.modulesCompleted(completedCount, totalModules);

  const nextModuleId = useMemo(() => {
    if (!modules.length) return null;
    const pending = modules.find((module) => !completedModules.includes(module.id));
    return (pending ?? modules[0])?.id ?? null;
  }, [modules, completedModules]);

  const handleDownloadDiploma = useCallback(async () => {
    if (!firebaseUser || downloading) {
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    try {
      const idToken = await firebaseUser.getIdToken();
      const response = await fetch('/api/diploma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: course.id, idToken }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || t.courses.diplomaDownloadError);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `kursbevis-${course.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download diploma', error);
      setDownloadError(
        error instanceof Error ? error.message : t.courses.diplomaDownloadError,
      );
    } finally {
      setDownloading(false);
    }
  }, [course.id, downloading, firebaseUser, t.courses.diplomaDownloadError]);

  const handleOpenModule = useCallback(
    (moduleId: string) => {
      router.push(`${basePath}/${course.id}/modules/${moduleId}?lang=${locale}`);
    },
    [course.id, locale, router, basePath],
  );

  const handleStartCourse = () => {
    if (!nextModuleId) return;
    router.push(`${basePath}/${course.id}/modules/${nextModuleId}?lang=${locale}`);
  };

  const startButtonLabel =
    completedCount > 0 ? t.courses.continueCourse : t.courses.startCourse;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-red-100 bg-red-50 px-6 py-4 text-sm text-red-600">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 pb-12">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {course.courseImageUrl ? (
          <div className="relative h-64 w-full overflow-hidden sm:h-80 md:h-96">
            <img
              src={course.courseImageUrl}
              alt={getLocalizedValue(course.title, locale) || course.id}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="flex h-48 items-center justify-center bg-gradient-to-br from-slate-200 to-slate-100 text-slate-500 sm:h-64 md:h-72">
            {t.courses.noImage}
          </div>
        )}
        <div className="flex flex-col gap-4 px-6 py-8 md:px-10">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900 sm:text-4xl">
              {getLocalizedValue(course.title, locale) || 'Kurs'}
            </h1>
            {updatedAt && (
              <p className="mt-1 text-xs text-slate-400">
                {t.courses.lastUpdated}{' '}
                {updatedAt.toLocaleString(getDateLocale(locale))}
              </p>
            )}
          </div>
          {description && (
            <p className="whitespace-pre-line text-base text-slate-600">
              {description}
            </p>
          )}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
              <span>{t.courses.courseProgress}</span>
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
          <div className="flex justify-center">
            <button
              onClick={handleStartCourse}
              disabled={!nextModuleId}
              className="mt-4 w-full max-w-xl rounded-2xl bg-slate-900 px-8 py-3 text-center text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {startButtonLabel}
            </button>
          </div>
          {isCourseCompleted && (
            <div className="mt-3 flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadDiploma}
                disabled={downloading}
                className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white px-8 py-3 text-center text-base font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {downloading ? t.courses.diplomaDownloading : t.courses.downloadDiploma}
              </button>
              {downloadError && <p className="text-sm text-red-600">{downloadError}</p>}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white px-6 py-8 shadow-sm md:px-10">
        <h2 className="text-2xl font-semibold text-slate-900">
          {t.courses.modules}
        </h2>
        <div className="mt-6 space-y-4">
          {modules.map((module, index) => {
            const isCompleted = completedModules.includes(module.id);
            const total = module.questions?.length ?? 0;
            const answered = moduleAnsweredCounts[module.id] ?? 0;
            const moduleProgressPercent = isCompleted
              ? 100
              : total > 0
              ? Math.min(Math.round((answered / total) * 100), 100)
              : 0;
            const localizedMedia = getLocalizedMediaItems(module.media, locale);
            const videoCount = localizedMedia.length
              ? localizedMedia.filter((item) => item.type === 'video').length
              : getLocalizedList(module.videoUrls, locale).length;
            return (
              <button
                key={module.id}
                type="button"
                onClick={() => handleOpenModule(module.id)}
                className="w-full cursor-pointer rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-300"
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {t.modules.module} {index + 1}
                </p>
                <h3 className="text-lg font-semibold text-slate-900">
                  {getLocalizedValue(module.title, locale) || t.common.untitled}
                </h3>
                {getLocalizedValue(module.summary, locale) && (
                  <p className="text-sm text-slate-600">
                    {getLocalizedValue(module.summary, locale)}
                  </p>
                )}
                {videoCount > 0 && (
                  <p className="mt-2 text-xs text-slate-400">
                    {t.modules.containsVideos(videoCount)}
                  </p>
                )}
                  <div className="mt-4">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-600">
                    <span>
                      {isCompleted
                        ? t.courses.completed
                        : moduleProgressPercent > 0
                        ? t.courses.inProgress
                        : t.courses.notStarted}
                    </span>
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
      </section>
    </div>
  );
}
