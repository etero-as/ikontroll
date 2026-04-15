'use client';

import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { Dialog, Transition } from '@headlessui/react';
import { ChevronDown } from 'lucide-react';

import { useCourseProgress } from '@/hooks/useCourseProgress';
import { useCourseModules } from '@/hooks/useCourseModules';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import type {
  Course,
  CourseModule,
  CourseQuestion,
  CourseQuestionAlternative,
} from '@/types/course';
import {
  getLocalizedList,
  getLocalizedValue,
  getPreferredLocale,
} from '@/utils/localization';
import { getLocalizedMediaItems } from '@/utils/media';
import { getTranslation } from '@/utils/translations';
import AnnotatedImage from '@/components/AnnotatedImage';

interface ConsumerModuleViewProps {
  course: Course;
  module: CourseModule;
  basePath?: string;
}

const DEFAULT_EXAM_PASS_PERCENTAGE = 80;

const isYouTubeUrl = (url: string): boolean =>
  /youtu\.be|youtube\.com/.test(url.toLowerCase());

const MediaImage = ({
  src,
  alt,
  className,
  imageMissingLabel,
  imageNotFoundLabel,
}: {
  src: string;
  alt: string;
  className?: string;
  imageMissingLabel?: string;
  imageNotFoundLabel?: string;
}) => {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center text-slate-400">
        <span className="text-3xl" role="img" aria-label={imageMissingLabel ?? 'Bildet mangler'}>🖼️</span>
        <p className="text-xs font-semibold">{imageNotFoundLabel ?? 'Bildet er ikke å finne'}</p>
      </div>
    );
  }
  return <Image src={src} alt={alt} fill unoptimized className={className} onError={() => setError(true)} />;
};

const getAlternativeLocaleFallback = (locale: string) =>
  locale === 'en' ? 'Option' : locale === 'it' ? 'Alternativa' : locale === 'sv' ? 'Alternativ' : 'Alternativ';

const getAlternativeLabel = (
  alternative: CourseQuestionAlternative,
  locale: string,
) => getLocalizedValue(alternative.altText, locale) || getAlternativeLocaleFallback(locale);

const getFileNameFromUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const pathname = decodeURIComponent(parsed.pathname);
    const candidate = pathname.split('/').pop();
    if (candidate && candidate.trim()) {
      return candidate;
    }
    return parsed.hostname;
  } catch {
    const parts = url.split('/');
    return decodeURIComponent(parts[parts.length - 1] || url);
  }
};

const clampPercentage = (value: number) => Math.min(100, Math.max(0, value));

const getCorrectAnswerIds = (question: CourseQuestion): string[] => {
  const alternatives = Array.isArray(question.alternatives)
    ? question.alternatives
    : [];
  const altIds = alternatives.map((alt) => alt.id).filter(Boolean);
  const rawCorrectIds = Array.isArray(question.correctAnswerIds)
    ? question.correctAnswerIds.filter(
        (id): id is string => typeof id === 'string' && altIds.includes(id),
      )
    : [];
  if (rawCorrectIds.length > 0) {
    return rawCorrectIds;
  }
  if (typeof question.correctAnswerId === 'string' && altIds.includes(question.correctAnswerId)) {
    return [question.correctAnswerId];
  }
  return altIds.length ? [altIds[0]] : [];
};

const isQuestionMultiCorrect = (question: CourseQuestion) =>
  getCorrectAnswerIds(question).length > 1;

const isQuestionAnswerCorrect = (
  question: CourseQuestion,
  selectedIds: string[] | undefined,
) => {
  const correctIds = getCorrectAnswerIds(question);
  if (!correctIds.length) return false;
  const selected = Array.isArray(selectedIds) ? selectedIds : [];
  if (selected.length !== correctIds.length) return false;
  return correctIds.every((id) => selected.includes(id));
};

type MediaPreviewType = 'image' | 'video' | 'document';

export default function ConsumerModuleView({
  course,
  module,
  basePath = '/my-courses',
}: ConsumerModuleViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedLang = searchParams.get('lang');
  const { firebaseUser } = useAuth();
  const { locale: preferredLocale, setLocale } = useLocale();
  const { completedModules, setModuleCompletion, moduleAnsweredCounts, moduleAnswers, saveModuleAnswers, loading: progressLoading } = useCourseProgress(course.id);
  const { modules: allModules } = useCourseModules(course.id);
  const modules = useMemo(
    () => allModules.filter((m) => (m.status ?? 'active') === 'active'),
    [allModules],
  );

  const availableLocales = useMemo(() => {
    const set = new Set<string>();
    if (module.title) Object.keys(module.title).forEach((lang) => set.add(lang));
    if (module.summary) Object.keys(module.summary).forEach((lang) => set.add(lang));
    if (module.body) Object.keys(module.body).forEach((lang) => set.add(lang));
    if (module.media) Object.keys(module.media).forEach((lang) => set.add(lang));
    Object.keys(module.videoUrls ?? {}).forEach((lang) => set.add(lang));
    Object.keys(module.imageUrls ?? {}).forEach((lang) => set.add(lang));
    module.questions?.forEach((question) => {
      Object.keys(question.contentText ?? {}).forEach((lang) => set.add(lang));
      question.alternatives.forEach((alternative) => {
        Object.keys(alternative.altText ?? {}).forEach((lang) => set.add(lang));
      });
    });
    if (course.title) Object.keys(course.title).forEach((lang) => set.add(lang));
    return Array.from(set);
  }, [module, course]);

  const locale = useMemo(
    () => getPreferredLocale(availableLocales, preferredLocale),
    [availableLocales, preferredLocale],
  );

  useEffect(() => {
    if (requestedLang) setLocale(requestedLang);
  }, [requestedLang, setLocale]);

  const t = getTranslation(locale);
  const moduleTranslations = t.modules as typeof t.modules & {
    examPassRequirement: (percent: number) => string;
    examPassed: string;
    examFailed: (percent: number) => string;
  };

  const localizedMedia = getLocalizedMediaItems(module.media, locale);
  const fallbackImages = getLocalizedList(module.imageUrls, locale);
  const fallbackVideos = getLocalizedList(module.videoUrls, locale);
  type MediaListItem = { url: string; type: MediaPreviewType; caption?: string; annotations?: import('@/types/course').AnnotationShape[] };
  const mediaItems = useMemo<MediaListItem[]>(
    () => {
      if (localizedMedia.length) {
        return localizedMedia.map((item): MediaListItem => ({
          url: item.url,
          type: item.type as MediaPreviewType,
          caption: item.caption,
          annotations: item.annotations,
        }));
      }
      return [
        ...fallbackImages.map((url): MediaListItem => ({ url, type: 'image' })),
        ...fallbackVideos.map((url): MediaListItem => ({ url, type: 'video' })),
      ];
    },
    [localizedMedia, fallbackImages, fallbackVideos],
  );
  const moduleTitle = getLocalizedValue(module.title, locale) || t.modules.module;
  const summary = getLocalizedValue(module.summary, locale);
  const rawBodyHtml = getLocalizedValue(module.body, locale);
  const bodyHtml = useMemo(() => {
    if (!rawBodyHtml) return '';
    const containsHtmlTags = /<\/?[a-z][\s\S]*>/i.test(rawBodyHtml);
    if (containsHtmlTags) {
      return rawBodyHtml;
    }
    const parts = rawBodyHtml.split('\n').map((line) => line.trim());
    return parts
      .map((line) => (line.length ? `<p>${line}</p>` : '<br />'))
      .join('');
  }, [rawBodyHtml]);
  const bodyHtmlWithExternalLinks = useMemo(() => {
    if (!bodyHtml) return '';
    if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
      return bodyHtml;
    }
    try {
      const doc = new DOMParser().parseFromString(bodyHtml, 'text/html');
      doc.querySelectorAll('a[href]').forEach((anchor) => {
        anchor.setAttribute('target', '_blank');
        anchor.setAttribute('rel', 'noopener noreferrer');
      });
      return doc.body.innerHTML;
    } catch {
      return bodyHtml;
    }
  }, [bodyHtml]);
  const questions = useMemo(() => module.questions ?? [], [module.questions]);
  const isModuleCompleted = completedModules.includes(module.id);

  const currentModuleIndex = useMemo(
    () => (modules ? modules.findIndex((m) => m.id === module.id) : -1),
    [modules, module.id],
  );
  const prevModuleItem =
    modules && currentModuleIndex > 0 ? modules[currentModuleIndex - 1] : null;
  const nextModuleNavItem =
    modules && currentModuleIndex >= 0 && currentModuleIndex < modules.length - 1
      ? modules[currentModuleIndex + 1]
      : null;
  const completedCount = modules
    ? modules.filter((m) => completedModules.includes(m.id)).length
    : 0;
  const progressPercent =
    modules?.length
      ? Math.round((completedCount / modules.length) * 100)
      : 0;

  const [moduleDropdownOpen, setModuleDropdownOpen] = useState(false);
  const moduleDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moduleDropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        moduleDropdownRef.current &&
        !moduleDropdownRef.current.contains(e.target as Node)
      ) {
        setModuleDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [moduleDropdownOpen]);

  const handleNavToModule = (targetModuleId: string) => {
    router.push(
      `${basePath}/${course.id}/modules/${targetModuleId}?lang=${locale}`,
    );
    window.scrollTo({ top: 0 });
  };


  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [answersInitialized, setAnswersInitialized] = useState(false);

  useEffect(() => {
    if (answersInitialized || progressLoading) return;
    const saved = moduleAnswers[module.id] ?? {};
    if (Object.keys(saved).length > 0) {
      setAnswers(saved);
      const firstUnanswered = questions.findIndex((q) => !saved[q.id]);
      setCurrentIndex(firstUnanswered === -1 ? 0 : firstUnanswered);
    }
    setAnswersInitialized(true);
  }, [answersInitialized, progressLoading, moduleAnswers, module.id, questions]);

  useEffect(() => {
    if (!answersInitialized) return;
    saveModuleAnswers(module.id, answers);
  }, [answers, answersInitialized, module.id, saveModuleAnswers]);
  const [showSummary, setShowSummary] = useState(false);
  const [showCourseComplete, setShowCourseComplete] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [mediaPreview, setMediaPreview] = useState<{ url: string; type: MediaPreviewType; caption?: string; annotations?: import('@/types/course').AnnotationShape[] } | null>(
    null,
  );
  const [previewImgError, setPreviewImgError] = useState(false);
  useEffect(() => {
    setPreviewImgError(false);
  }, [mediaPreview?.url]);
  const courseCompletionAcknowledgedRef = useRef(false);
  const completionRecordedRef = useRef(false);

  const currentQuestion: CourseQuestion | undefined = questions[currentIndex];
  const handleSelectAlternative = (question: CourseQuestion, alternativeId: string) => {
    setAnswers((prev) => {
      const existing = prev[question.id] ?? [];
      if (isQuestionMultiCorrect(question)) {
        const next = existing.includes(alternativeId)
          ? existing.filter((id) => id !== alternativeId)
          : [...existing, alternativeId];
        return { ...prev, [question.id]: next };
      }
      return { ...prev, [question.id]: [alternativeId] };
    });
  };

  const handleNext = () => {
    if (!currentQuestion) return;
    if (currentIndex === questions.length - 1) {
      setShowSummary(true);
    } else {
      setCurrentIndex((prev) => Math.min(prev + 1, questions.length - 1));
    }
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  };

  const resetQuiz = () => {
    courseCompletionAcknowledgedRef.current = false;
    setAnswers({});
    setCurrentIndex(0);
    setShowSummary(false);
    setShowCourseComplete(false);
  };

  const incorrectQuestions = useMemo(
    () =>
      questions.filter(
        (question) => !isQuestionAnswerCorrect(question, answers[question.id]),
      ),
    [questions, answers],
  );

  const moduleType = module.moduleType ?? 'normal';
  const isExamModule = moduleType === 'exam';
  const scorePercentage = questions.length
    ? Math.round(
        ((questions.length - incorrectQuestions.length) / questions.length) * 100,
      )
    : 0;
  const requiredPercentage = isExamModule
    ? clampPercentage(
        typeof module.examPassPercentage === 'number'
          ? module.examPassPercentage
          : DEFAULT_EXAM_PASS_PERCENTAGE,
      )
    : 100;
  const hasPassed = isExamModule
    ? scorePercentage >= requiredPercentage
    : incorrectQuestions.length === 0;

  useEffect(() => {
    if (!module.id || !showSummary || questions.length === 0) {
      return;
    }
    if (hasPassed) {
      setModuleCompletion(module.id, true).then(() => {
        // Check for overall course completion
        if (!modules) return;
        
        const allOtherModulesCompleted = modules
          .filter(m => m.id !== module.id)
          .every(m => completedModules.includes(m.id));
          
        if (allOtherModulesCompleted && !courseCompletionAcknowledgedRef.current) {
          setShowCourseComplete(true);
        }
      }).catch((err) => {
        console.error('Failed to update module progress', err);
      });
    }
  }, [
    module.id,
    showSummary,
    hasPassed,
    questions.length,
    setModuleCompletion,
    completedModules,
    modules,
  ]);

  useEffect(() => {
    if (!showCourseComplete) {
      return;
    }

    confetti({
      particleCount: 50,
      spread: 65,
      angle: 115,
      startVelocity: 40,
      gravity: 1.05,
      origin: { x: 0.48, y: 0.58 },
      colors: ['#10b981', '#34d399', '#059669', '#f8fafc'],
    });
    confetti({
      particleCount: 50,
      spread: 65,
      angle: 65,
      startVelocity: 40,
      gravity: 1.05,
      origin: { x: 0.52, y: 0.58 },
        colors: ['#10b981', '#34d399', '#059669', '#f8fafc'],
    });
  }, [showCourseComplete]);

  const courseOverviewHref = useMemo(
    () => `${basePath}/${course.id}?lang=${locale}`,
    [basePath, course.id, locale],
  );

  const acknowledgeCompletion = useCallback(() => {
    courseCompletionAcknowledgedRef.current = true;
    setShowSummary(false);
    setShowCourseComplete(false);
  }, []);

  const recordCourseCompletion = useCallback(async () => {
    if (!firebaseUser || completionRecordedRef.current) {
      return;
    }
    completionRecordedRef.current = true;
    try {
      const idToken = await firebaseUser.getIdToken();
      const response = await fetch('/api/course-completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: course.id, idToken }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        console.error('Failed to record course completion', response.status, payload);
        completionRecordedRef.current = false;
      }
    } catch (error) {
      console.error('Failed to record course completion', error);
      completionRecordedRef.current = false;
    }
  }, [course.id, firebaseUser]);

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
        throw new Error(payload.error || 'Kunne ikke laste ned kursbevis.');
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
        error instanceof Error ? error.message : 'Kunne ikke laste ned kursbevis.',
      );
    } finally {
      setDownloading(false);
    }
  }, [course.id, downloading, firebaseUser]);

  useEffect(() => {
    if (showCourseComplete) {
      recordCourseCompletion();
    }
  }, [recordCourseCompletion, showCourseComplete]);

  const handleReturnToCourse = useCallback(() => {
    acknowledgeCompletion();
    router.replace(courseOverviewHref);
  }, [acknowledgeCompletion, router, courseOverviewHref]);

  // Find next module
  const nextModuleId = useMemo(() => {
    if (!modules) return null;
    const currentIndex = modules.findIndex(m => m.id === module.id);
    if (currentIndex === -1 || currentIndex === modules.length - 1) return null;
    return modules[currentIndex + 1].id;
  }, [modules, module.id]);

  const handleGoToNextModule = () => {
    if (nextModuleId) {
      router.push(`${basePath}/${course.id}/modules/${nextModuleId}?lang=${locale}`);
    }
  };

  const canAdvance = isExamModule ? hasPassed : incorrectQuestions.length === 0;

  if (showCourseComplete) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12 md:px-8">
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center px-4">
        <div className="rounded-full bg-emerald-100 p-6">
          <div className="text-6xl">🏆</div>
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">
            {t.modules.courseCompleteHeading}
          </h1>
          <p className="text-lg text-slate-600">
            {t.modules.courseCompleteDescription(
              getLocalizedValue(course.title, locale),
            )}
          </p>
        </div>
        <div className="mt-4 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={handleDownloadDiploma}
            disabled={downloading}
            className="rounded-2xl bg-slate-900 px-8 py-3 text-base font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {downloading ? t.courses.diplomaDownloading : t.courses.downloadDiploma}
          </button>
          <button
            type="button"
            onClick={handleReturnToCourse}
            className="rounded-2xl border border-slate-200 bg-white px-8 py-3 text-base font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {t.modules.backToOverview}
          </button>
          {downloadError && <p className="text-sm text-red-600">{downloadError}</p>}
        </div>
      </div>
      </div>
    );
  }

  return (
    <>
      <div className="sticky top-16 z-30 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 md:px-8">
          <button
            onClick={() => router.replace(courseOverviewHref)}
            className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            ← {t.modules.backToOverview}
          </button>
          <span className="hidden h-4 w-px bg-slate-200 md:block" />
          <button
            disabled={!prevModuleItem}
            onClick={() => prevModuleItem && handleNavToModule(prevModuleItem.id)}
            className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ‹ {t.modules.navPrevious}
          </button>
          <button
            disabled={!nextModuleNavItem}
            onClick={() => nextModuleNavItem && handleNavToModule(nextModuleNavItem.id)}
            className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t.modules.navNext} ›
          </button>
          <div className="relative" ref={moduleDropdownRef}>
            <button
              onClick={() => setModuleDropdownOpen((p) => !p)}
              className="flex max-w-55 items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <span className="truncate">{moduleTitle}</span>
              <ChevronDown size={14} className="shrink-0" />
            </button>
            {moduleDropdownOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                {(modules ?? []).map((m, i) => {
                  const isCompleted = completedModules.includes(m.id);
                  const total = m.questions?.length ?? 0;
                  const liveCount = m.id === module.id ? Object.keys(answers).length : 0;
                  const persistedCount = moduleAnsweredCounts[m.id] ?? 0;
                  const answeredCount = Math.max(liveCount, persistedCount);
                  const pct = isCompleted
                    ? 100
                    : total > 0
                    ? Math.min(Math.round((answeredCount / total) * 100), 100)
                    : 0;
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        handleNavToModule(m.id);
                        setModuleDropdownOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 ${
                        m.id === module.id
                          ? 'font-semibold text-slate-900'
                          : 'text-slate-600'
                      }`}
                    >
                      <span className="flex-1 truncate">
                        {i + 1}.{' '}
                        {getLocalizedValue(m.title, locale) || t.common.untitled}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <div className="h-1 w-8 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className={`w-7 text-right text-xs font-medium ${pct === 100 ? 'text-emerald-500' : 'text-slate-400'}`}>
                          {pct}%
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">
              {completedCount}/{modules?.length ?? 0}
            </span>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-slate-900 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 pt-6 md:px-8">
        <div className="flex flex-col gap-8 pb-12">
        <div className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {t.modules.module}
            </p>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                isModuleCompleted
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {isModuleCompleted ? t.courses.completed : t.courses.notStarted}
            </span>
          </div>
          <h1 className="text-3xl font-semibold text-slate-900 sm:text-4xl">
            {moduleTitle}
          </h1>

          {mediaItems.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {t.modules.mediaGallery}
              </p>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {mediaItems.map(({ url, type, caption, annotations }) => {
                  const isVideo = type === 'video';
                  const isDocument = type === 'document';
                  const hasAnnotationData = annotations && annotations.length > 0;
                  return (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setMediaPreview({ url, type, caption, annotations })}
                      className="flex flex-col shrink-0 w-[165px] overflow-hidden rounded-xl border border-slate-200 bg-slate-100 transition hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-slate-300"
                    >
                      <div className="relative h-[165px] w-full shrink-0 overflow-hidden bg-slate-100">
                        {isVideo ? (
                          <>
                            {isYouTubeUrl(url) ? (
                              <iframe
                                src={`${url}${url.includes('?') ? '&' : '?'}controls=0&modestbranding=1&playsinline=1&rel=0`}
                                title={t.modules.moduleVideo}
                                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                                className="h-full w-full pointer-events-none"
                              />
                            ) : (
                              <video
                                className="h-full w-full bg-black object-cover"
                                muted
                                playsInline
                                preload="metadata"
                                controls={false}
                              >
                                <source src={url} />
                                {t.modules.videoNotSupported}
                              </video>
                            )}
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                              <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-slate-900 shadow">
                                ▶
                              </span>
                            </div>
                          </>
                        ) : isDocument ? (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-slate-700">
                            <span className="text-4xl" role="img" aria-label="PDF">
                              📄
                            </span>
                            <span className="text-xs font-semibold line-clamp-3 break-words">
                              {getFileNameFromUrl(url)}
                            </span>
                          </div>
                        ) : hasAnnotationData ? (
                          <AnnotatedImage
                            src={url}
                            alt={t.modules.moduleImage}
                            annotations={annotations}
                            className="h-full w-full"
                          />
                        ) : (
                          <MediaImage src={url} alt={t.modules.moduleImage} className="h-full w-full object-contain" imageMissingLabel={t.modules.imageMissing} imageNotFoundLabel={t.modules.imageNotFound} />
                        )}
                      </div>
                      {caption && (
                        <div className="w-full bg-slate-50 border-t border-slate-200 px-2 py-1.5 text-left text-xs text-slate-600 leading-snug">
                          {caption}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {summary && <p className="text-base text-slate-600">{summary}</p>}
        </div>

        {bodyHtml && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
            <h2 className="text-xl font-semibold text-slate-900">{t.modules.content}</h2>
            <div
              className="prose prose-slate mt-4 max-w-none"
              dangerouslySetInnerHTML={{ __html: bodyHtmlWithExternalLinks }}
            />
          </section>
        )}

      {questions.length > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">{t.modules.questions}</h2>
            <span className="text-sm text-slate-500">
              {showSummary
                ? t.modules.summary
                : `${t.modules.question} ${currentIndex + 1} av ${questions.length}`}
            </span>
          </div>

          {showSummary ? (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
                <p>
                  {t.modules.result(questions.length - incorrectQuestions.length, questions.length, scorePercentage)}
                </p>
                {isExamModule && (
                  <p className="mt-2 text-sm font-semibold">
                    {hasPassed
                      ? moduleTranslations.examPassed
                      : moduleTranslations.examFailed(requiredPercentage)}
                  </p>
                )}
                {isExamModule && (
                  <p className="mt-1 text-xs text-slate-500">
                    {moduleTranslations.examPassRequirement(requiredPercentage)}
                  </p>
                )}
              </div>
              {incorrectQuestions.length > 0 ? (
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-slate-700">
                    {t.modules.reviewQuestions}
                  </p>
                  {incorrectQuestions.map((question) => {
                    const questionText = getLocalizedValue(
                      question.contentText,
                      locale,
                    );
                    const correctIds = getCorrectAnswerIds(question);
                    const correctAlternatives = question.alternatives.filter((alternative) =>
                      correctIds.includes(alternative.id),
                    );
                    const selectedIds = answers[question.id] ?? [];
                    const userAlternatives = question.alternatives.filter((alternative) =>
                      selectedIds.includes(alternative.id),
                    );
                    const userAnswerText = userAlternatives.length
                      ? userAlternatives
                          .map((alternative) => getAlternativeLabel(alternative, locale))
                          .join(', ')
                      : '—';
                    const correctAnswerText = correctAlternatives
                      .map((alternative) => getAlternativeLabel(alternative, locale))
                      .join(', ');
                    return (
                      <div
                        key={question.id}
                        className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4"
                      >
                        <p className="text-base font-semibold text-red-700">
                          {questionText || t.modules.question}
                        </p>
                        <p className="mt-2 text-sm text-red-600">
                          {t.modules.yourAnswer} {userAnswerText}
                        </p>
                        {correctAnswerText && (
                          <p className="text-sm text-slate-600">
                            {t.modules.correctAnswer} {correctAnswerText}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
                  {t.modules.allCorrect}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-3">
                  {incorrectQuestions.length > 0 && (
                    <button
                    type="button"
                    onClick={resetQuiz}
                      className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      {t.modules.retry}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => router.replace(courseOverviewHref)}
                    className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    {t.modules.backToOverview}
                  </button>
                </div>
                {canAdvance && nextModuleId && !showCourseComplete && (
                  <button
                  type="button"
                    onClick={handleGoToNextModule}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    {t.modules.nextModule}
                  </button>
                )}
              </div>
            </div>
          ) : currentQuestion ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-base font-semibold text-slate-700">
                {getLocalizedValue(currentQuestion.contentText, locale) || t.modules.question}
              </div>
              <div className="space-y-3">
                {currentQuestion.alternatives.map((alternative) => {
                  const label = getAlternativeLabel(alternative, locale);
                  const isSelected = (answers[currentQuestion.id] ?? []).includes(
                    alternative.id,
                  );
                  return (
                    <button
                      key={alternative.id}
                      onClick={() =>
                        handleSelectAlternative(currentQuestion, alternative.id)
                      }
                      className={`w-full rounded-2xl border px-4 py-3 text-left text-sm transition ${
                        isSelected
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={handlePrev}
                  disabled={currentIndex === 0}
                  className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t.modules.previousQuestion}
                </button>
                <button
                  onClick={handleNext}
                  disabled={!(answers[currentQuestion.id]?.length ?? 0)}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {currentIndex === questions.length - 1
                    ? t.modules.finishQuiz
                    : t.modules.nextQuestion}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">{t.modules.noQuestions}</p>
          )}
        </section>
      )}

      {questions.length === 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm md:p-10">
          {t.modules.noQuestionsYet}
        </div>
      )}

      <Transition show={!!mediaPreview} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-40"
          onClose={() => setMediaPreview(null)}
        >
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/70" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="relative w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
                  <button
                    type="button"
                    onClick={() => setMediaPreview(null)}
                    className="absolute right-4 top-4 rounded-full bg-white/80 p-2 text-slate-700 shadow hover:bg-white"
                  >
                    ✕
                  </button>
                  {mediaPreview && (
                    <>
                      <div className="flex w-full items-center justify-center overflow-hidden bg-slate-100">
                        {mediaPreview.type === 'video' ? (
                          isYouTubeUrl(mediaPreview.url) ? (
                            <iframe
                              src={mediaPreview.url}
                              title={t.modules.moduleMedia}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                              className="h-[80vh] w-full"
                            />
                          ) : (
                            <video controls className="h-[80vh] w-full object-contain bg-black">
                              <source src={mediaPreview.url} />
                              {t.modules.videoNotSupported}
                            </video>
                          )
                        ) : mediaPreview.type === 'document' ? (
                          <iframe
                            src={mediaPreview.url}
                            title={t.modules.moduleDocument}
                            className="h-[80vh] w-full bg-white"
                          />
                        ) : previewImgError ? (
                          <div className="flex flex-col items-center justify-center gap-3 p-16 text-slate-400">
                            <span className="text-5xl" role="img" aria-label={t.modules.imageMissing}>🖼️</span>
                            <p className="text-sm font-semibold">{t.modules.imageNotFound}</p>
                          </div>
                        ) : mediaPreview.annotations?.length ? (
                          <div className="h-[85vh] w-full">
                            <AnnotatedImage
                              src={mediaPreview.url}
                              alt={t.modules.moduleImage}
                              annotations={mediaPreview.annotations}
                              className="h-full w-full"
                            />
                          </div>
                        ) : (
                          <Image
                            src={mediaPreview.url}
                            alt={t.modules.moduleImage}
                            width={0}
                            height={0}
                            sizes="100vw"
                            unoptimized
                            className="block object-contain"
                            style={{ width: 'auto', height: 'auto', maxWidth: '100%', maxHeight: '85vh' }}
                            onError={() => setPreviewImgError(true)}
                          />
                        )}
                      </div>
                      {mediaPreview.caption && (
                        <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 text-sm text-slate-700">
                          {mediaPreview.caption}
                        </div>
                      )}
                    </>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
      </div>
      </div>
    </>
  );
}
