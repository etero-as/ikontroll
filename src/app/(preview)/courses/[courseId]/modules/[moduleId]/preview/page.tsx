'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { Dialog, Transition } from '@headlessui/react';
import { ChevronDown } from 'lucide-react';

import { useCourse } from '@/hooks/useCourse';
import { useCourseModule } from '@/hooks/useCourseModule';
import { useCourseModules } from '@/hooks/useCourseModules';
import { getFileNameFromUrl, getLocalizedMediaItems } from '@/utils/media';
import {
  getLocalizedList,
  getLocalizedValue,
  getPreferredLocale,
} from '@/utils/localization';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import AnnotatedImage from '@/components/AnnotatedImage';
import { useLocale } from '@/context/LocaleContext';
import type {
  AnnotationShape,
  CourseQuestion,
  CourseQuestionAlternative,
} from '@/types/course';

const isYouTubeUrl = (url: string): boolean =>
  /youtu\.be|youtube\.com/.test(url.toLowerCase());

const PreviewMediaImage = ({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) => {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center text-slate-300">
        🖼️
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      className={className}
      onError={() => setError(true)}
    />
  );
};

const getAlternativeLabel = (
  alternative: CourseQuestionAlternative,
  locale: string,
  fallback: string,
) => getLocalizedValue(alternative.altText, locale) || fallback;

const DEFAULT_EXAM_PASS_PERCENTAGE = 80;
const clampPercentage = (value: number) => Math.min(100, Math.max(0, value));

const getCorrectAnswerIds = (question: CourseQuestion): string[] => {
  const alternatives = Array.isArray(question.alternatives)
    ? question.alternatives
    : [];
  const altIds = alternatives.map((alt) => alt.id).filter(Boolean);
  const rawCorrectIds = Array.isArray(question.correctAnswerIds)
    ? question.correctAnswerIds.filter((id): id is string => altIds.includes(id))
    : [];
  if (rawCorrectIds.length > 0) return rawCorrectIds;
  if (
    typeof question.correctAnswerId === 'string' &&
    altIds.includes(question.correctAnswerId)
  )
    return [question.correctAnswerId];
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

const getLabels = (locale: string) => {
  switch (locale) {
    case 'en':
      return {
        moduleLabel: 'Module',
        mediaGallery: 'Media gallery',
        content: 'Content',
        quizHeading: 'Quiz questions',
        questionCounter: (current: number, total: number) =>
          `Question ${current} of ${total}`,
        summary: 'Summary',
        scoreText: (correct: number, total: number, pct: number) =>
          `You got ${correct} of ${total} correct (${pct}%).`,
        examPassed: 'Exam passed.',
        examFailed: (required: number) =>
          `Exam not passed. Required: ${required}%.`,
        reviewPrompt: 'Questions to review:',
        yourAnswer: 'Your answer:',
        correctAnswer: 'Correct answer:',
        allCorrect: 'Great! You answered all questions correctly.',
        noQuestions: 'No questions available.',
        noQuizYet: 'This module has no quiz questions yet.',
        alternativeFallback: 'Option',
        questionFallback: 'Question',
        backToCourse: 'Course overview',
        allModules: 'All modules',
        previousModule: 'Previous module',
        nextModule: 'Next module',
        progressLabel: (done: number, total: number) => `${done}/${total}`,
        completed: 'Completed',
        notCompleted: 'Not completed',
        previousQuestion: 'Previous question',
        nextQuestion: 'Next question',
        finishQuiz: 'Finish quiz',
        retakeQuiz: 'Retake quiz',
        backToOverview: 'Back to course',
        loading: 'Loading module …',
        notFound: 'Module not found',
        videoNotSupported: 'Your browser does not support video.',
        untitled: 'Untitled',
      };
    case 'it':
      return {
        moduleLabel: 'Modulo',
        mediaGallery: 'Galleria media',
        content: 'Contenuto',
        quizHeading: 'Domande del quiz',
        questionCounter: (current: number, total: number) =>
          `Domanda ${current} di ${total}`,
        summary: 'Riepilogo',
        scoreText: (correct: number, total: number, pct: number) =>
          `Hai risposto correttamente a ${correct} su ${total} (${pct}%).`,
        examPassed: 'Esame superato.',
        examFailed: (required: number) =>
          `Esame non superato. Richiesto: ${required}%.`,
        reviewPrompt: 'Domande da rivedere:',
        yourAnswer: 'La tua risposta:',
        correctAnswer: 'Risposta corretta:',
        allCorrect: 'Ottimo! Hai risposto correttamente a tutte le domande.',
        noQuestions: 'Nessuna domanda disponibile.',
        noQuizYet: 'Questo modulo non ha ancora domande.',
        alternativeFallback: 'Alternativa',
        questionFallback: 'Domanda',
        backToCourse: 'Panoramica del corso',
        allModules: 'Tutti i moduli',
        previousModule: 'Modulo precedente',
        nextModule: 'Modulo successivo',
        progressLabel: (done: number, total: number) => `${done}/${total}`,
        completed: 'Completato',
        notCompleted: 'Non completato',
        previousQuestion: 'Domanda precedente',
        nextQuestion: 'Domanda successiva',
        finishQuiz: 'Termina quiz',
        retakeQuiz: 'Ricomincia il quiz',
        backToOverview: 'Torna al corso',
        loading: 'Caricamento modulo …',
        notFound: 'Modulo non trovato',
        videoNotSupported: 'Il browser non supporta il video.',
        untitled: 'Senza titolo',
      };
    case 'sv':
      return {
        moduleLabel: 'Modul',
        mediaGallery: 'Mediagalleri',
        content: 'Innehåll',
        quizHeading: 'Kontrollfrågor',
        questionCounter: (current: number, total: number) =>
          `Fråga ${current} av ${total}`,
        summary: 'Sammanfattning',
        scoreText: (correct: number, total: number, pct: number) =>
          `Du fick ${correct} av ${total} rätt (${pct}%).`,
        examPassed: 'Examen godkänd.',
        examFailed: (required: number) =>
          `Examen inte godkänd. Krav: ${required}%.`,
        reviewPrompt: 'Frågor att se över:',
        yourAnswer: 'Ditt svar:',
        correctAnswer: 'Rätt svar:',
        allCorrect: 'Bra! Du svarade rätt på alla frågor.',
        noQuestions: 'Inga frågor tillgängliga.',
        noQuizYet: 'Det här modulet har inga kontrollfrågor ännu.',
        alternativeFallback: 'Alternativ',
        questionFallback: 'Fråga',
        backToCourse: 'Kursöversikt',
        allModules: 'Alla moduler',
        previousModule: 'Föregående modul',
        nextModule: 'Nästa modul',
        progressLabel: (done: number, total: number) => `${done}/${total}`,
        completed: 'Slutförd',
        notCompleted: 'Inte slutförd',
        previousQuestion: 'Föregående fråga',
        nextQuestion: 'Nästa fråga',
        finishQuiz: 'Avsluta quiz',
        retakeQuiz: 'Gör om quizzen',
        backToOverview: 'Tillbaka till kursen',
        loading: 'Laddar modul …',
        notFound: 'Modul hittades inte',
        videoNotSupported: 'Webbläsaren stöder inte video.',
        untitled: 'Utan titel',
      };
    default:
      return {
        moduleLabel: 'Emne',
        mediaGallery: 'Mediegalleri',
        content: 'Innhold',
        quizHeading: 'Kontrollspørsmål',
        questionCounter: (current: number, total: number) =>
          `Spørsmål ${current} av ${total}`,
        summary: 'Oppsummering',
        scoreText: (correct: number, total: number, pct: number) =>
          `Du fikk ${correct} av ${total} riktige (${pct}%).`,
        examPassed: 'Eksamen bestått.',
        examFailed: (required: number) =>
          `Eksamen ikke bestått. Krav: ${required}%.`,
        reviewPrompt: 'Spørsmål du bør se gjennom igjen:',
        yourAnswer: 'Ditt svar:',
        correctAnswer: 'Riktig svar:',
        allCorrect: 'Flott! Du svarte riktig på alle spørsmål.',
        noQuestions: 'Ingen spørsmål er tilgjengelige.',
        noQuizYet: 'Dette emnet har ikke kontrollspørsmål ennå.',
        alternativeFallback: 'Alternativ',
        questionFallback: 'Spørsmål',
        backToCourse: 'Kursoversikt',
        allModules: 'Alle emner',
        previousModule: 'Forrige emne',
        nextModule: 'Neste emne',
        progressLabel: (done: number, total: number) => `${done}/${total}`,
        completed: 'Fullført',
        notCompleted: 'Ikke fullført',
        previousQuestion: 'Forrige spørsmål',
        nextQuestion: 'Neste spørsmål',
        finishQuiz: 'Fullfør quiz',
        retakeQuiz: 'Ta quizen på nytt',
        backToOverview: 'Tilbake til kurset',
        loading: 'Laster emne …',
        notFound: 'Fant ikke emne',
        videoNotSupported: 'Nettleseren din støtter ikke video.',
        untitled: 'Uten tittel',
      };
  }
};

type MediaPreviewType = 'image' | 'video' | 'document';

const COURSE_LOCALE_LABELS: Record<string, string> = {
  no: 'Norsk',
  en: 'English',
  it: 'Italiano',
  sv: 'Svenska',
};

export default function ModulePreviewPage({
  params,
}: {
  params: Promise<{ courseId: string; moduleId: string }>;
}) {
  const { courseId, moduleId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedLang = searchParams.get('lang');

  const { course } = useCourse(courseId);
  const { module, loading, error } = useCourseModule(courseId, moduleId);
  const { modules: allModules } = useCourseModules(courseId);
  const modules = useMemo(
    () => allModules.filter((m) => (m.status ?? 'active') === 'active'),
    [allModules],
  );

  const completedSessionKey = `preview-completed-${courseId}`;

  const [completedModules, setCompletedModules] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = sessionStorage.getItem(`preview-completed-${courseId}`);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  });

  const markModuleComplete = useCallback((targetModuleId: string, isComplete: boolean) => {
    setCompletedModules((prev) => {
      const next = isComplete
        ? Array.from(new Set([...prev, targetModuleId]))
        : prev.filter((id) => id !== targetModuleId);
      try {
        sessionStorage.setItem(completedSessionKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [completedSessionKey]);

  const availableLocales = useMemo(() => {
    const set = new Set<string>();
    if (module?.title) Object.keys(module.title).forEach((lang) => set.add(lang));
    if (module?.summary)
      Object.keys(module.summary).forEach((lang) => set.add(lang));
    if (module?.body) Object.keys(module.body).forEach((lang) => set.add(lang));
    if (module?.media) Object.keys(module.media).forEach((lang) => set.add(lang));
    Object.keys(module?.videoUrls ?? {}).forEach((lang) => set.add(lang));
    Object.keys(module?.imageUrls ?? {}).forEach((lang) => set.add(lang));
    module?.questions?.forEach((question) => {
      Object.keys(question.contentText ?? {}).forEach((lang) => set.add(lang));
      question.alternatives.forEach((alt) => {
        Object.keys(alt.altText ?? {}).forEach((lang) => set.add(lang));
      });
    });
    if (course?.title) Object.keys(course.title).forEach((lang) => set.add(lang));
    return Array.from(set);
  }, [module, course]);

  const { locale: uiLocale } = useLocale();

  const locale = useMemo(
    () => getPreferredLocale(availableLocales, requestedLang),
    [availableLocales, requestedLang],
  );

  const LNav = getLabels(uiLocale);
  const L = getLabels(locale);

  const courseLocaleOptions = useMemo(
    () =>
      availableLocales.map((code) => ({
        code,
        label: COURSE_LOCALE_LABELS[code] ?? code.toUpperCase(),
      })),
    [availableLocales],
  );

  const localizedMedia = getLocalizedMediaItems(module?.media, locale);
  const images = getLocalizedList(module?.imageUrls, locale);
  const videos = getLocalizedList(module?.videoUrls, locale);
  type PreviewMediaItem = {
    id: string;
    url: string;
    type: 'image' | 'video' | 'document';
    caption?: string;
    annotations?: AnnotationShape[];
  };
  const mediaItems: PreviewMediaItem[] = localizedMedia.length
    ? localizedMedia
    : [
        ...images.map((url) => ({ id: url, url, type: 'image' as const })),
        ...videos.map((url) => ({ id: url, url, type: 'video' as const })),
      ];

  const moduleTitle = getLocalizedValue(module?.title, locale) || L.moduleLabel;
  const summary = getLocalizedValue(module?.summary, locale);
  const rawBodyHtml = getLocalizedValue(module?.body, locale);
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
  const questions = useMemo(() => module?.questions ?? [], [module?.questions]);
  const isModuleCompleted = completedModules.includes(moduleId);

  const currentModuleIndex = useMemo(
    () => modules.findIndex((m) => m.id === moduleId),
    [modules, moduleId],
  );
  const prevModuleItem =
    currentModuleIndex > 0 ? modules[currentModuleIndex - 1] : null;
  const nextModuleItem =
    currentModuleIndex >= 0 && currentModuleIndex < modules.length - 1
      ? modules[currentModuleIndex + 1]
      : null;
  const completedCount = modules.filter((m) =>
    completedModules.includes(m.id),
  ).length;
  const progressPercent = modules.length
    ? Math.round((completedCount / modules.length) * 100)
    : 0;

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [dropdownOpen]);

  const handleNavModule = (targetModuleId: string) => {
    router.push(
      `/courses/${courseId}/modules/${targetModuleId}/preview?lang=${locale}`,
    );
  };

  const handleLocaleChange = (lang: string) => {
    const p = new URLSearchParams(searchParams.toString());
    p.set('lang', lang);
    router.replace(
      `/courses/${courseId}/modules/${moduleId}/preview?${p.toString()}`,
    );
  };

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [showSummary, setShowSummary] = useState(false);

  const sessionKey = `preview-progress-${courseId}`;

  const [sessionAnsweredCounts, setSessionAnsweredCounts] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = sessionStorage.getItem(`preview-progress-${courseId}`);
      return raw ? (JSON.parse(raw) as Record<string, number>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const count = Object.keys(answers).length;
    setSessionAnsweredCounts((prev) => {
      const prevCount = prev[moduleId] ?? 0;
      if (count <= prevCount) return prev;
      const next = { ...prev, [moduleId]: count };
      try {
        sessionStorage.setItem(sessionKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [answers, moduleId, sessionKey]);

  const currentQuestion: CourseQuestion | undefined = questions[currentIndex];

  const handleSelectAlternative = (
    question: CourseQuestion,
    alternativeId: string,
  ) => {
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
    setAnswers({});
    setCurrentIndex(0);
    setShowSummary(false);
  };

  const incorrectQuestions = useMemo(
    () => questions.filter((q) => !isQuestionAnswerCorrect(q, answers[q.id])),
    [questions, answers],
  );

  const isExamModule = module?.moduleType === 'exam';
  const scorePercentage = questions.length
    ? Math.round(
        ((questions.length - incorrectQuestions.length) / questions.length) *
          100,
      )
    : 0;
  const requiredPercentage = isExamModule
    ? clampPercentage(
        typeof module?.examPassPercentage === 'number'
          ? module.examPassPercentage
          : DEFAULT_EXAM_PASS_PERCENTAGE,
      )
    : 100;
  const hasPassed = isExamModule
    ? scorePercentage >= requiredPercentage
    : incorrectQuestions.length === 0;

  useEffect(() => {
    if (!module?.id || !showSummary || questions.length === 0) return;
    markModuleComplete(module.id, hasPassed);
  }, [module?.id, showSummary, hasPassed, questions.length, markModuleComplete]);

  const [mediaPreview, setMediaPreview] = useState<{
    url: string;
    type: MediaPreviewType;
    caption?: string;
    annotations?: AnnotationShape[];
  } | null>(null);
  const [previewImgError, setPreviewImgError] = useState(false);
  useEffect(() => {
    setPreviewImgError(false);
  }, [mediaPreview?.url]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        {L.loading}
      </div>
    );
  }

  if (error || !module) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-red-100 bg-red-50 px-6 py-4 text-sm text-red-600">
          {error ?? L.notFound}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="sticky top-16 z-30 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 md:px-8">
          <button
            onClick={() =>
              router.push(`/courses/${courseId}/preview?lang=${locale}`)
            }
            className="flex cursor-pointer items-center gap-1 rounded-xl px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            ← {LNav.backToCourse}
          </button>
          <span className="hidden h-4 w-px bg-slate-200 md:block" />
          <button
            disabled={!prevModuleItem}
            onClick={() => prevModuleItem && handleNavModule(prevModuleItem.id)}
            className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ‹ {LNav.previousModule}
          </button>
          <button
            disabled={!nextModuleItem}
            onClick={() => nextModuleItem && handleNavModule(nextModuleItem.id)}
            className="rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {LNav.nextModule} ›
          </button>
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((p) => !p)}
              className="flex max-w-55 items-center gap-1.5 rounded-xl border border-slate-200 px-2.5 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <span className="truncate">{moduleTitle}</span>
              <ChevronDown size={14} className="shrink-0" />
            </button>
            {dropdownOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 max-h-64 w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
                {modules.map((m, i) => {
                  const isCompleted = completedModules.includes(m.id);
                  const total = m.questions?.length ?? 0;
                  const liveCount = m.id === moduleId ? Object.keys(answers).length : 0;
                  const persistedCount = sessionAnsweredCounts[m.id] ?? 0;
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
                        handleNavModule(m.id);
                        setDropdownOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 ${
                        m.id === moduleId
                          ? 'font-semibold text-slate-900'
                          : 'text-slate-600'
                      }`}
                    >
                      <span className="flex-1 truncate">
                        {i + 1}.{' '}
                        {getLocalizedValue(m.title, locale) || L.untitled}
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
              {LNav.progressLabel(completedCount, modules.length)}
            </span>
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-slate-900 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
          <LanguageSwitcher
            locale={locale}
            onChange={handleLocaleChange}
            locales={courseLocaleOptions}
            savePreference={false}
          />
        </div>
      </div>

      <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-4 pb-12 pt-8 md:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {L.moduleLabel}
            </p>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                isModuleCompleted
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {isModuleCompleted ? L.completed : L.notCompleted}
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900 sm:text-4xl">
            {moduleTitle}
          </h1>

          {mediaItems.length > 0 && (
            <div className="mt-6 space-y-3">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {L.mediaGallery}
              </p>
              <div className="flex gap-4 overflow-x-auto pb-2">
                {mediaItems.map((item) => {
                  const isVideo = item.type === 'video';
                  const isDoc = item.type === 'document';
                  const hasAnnotationData = item.annotations && item.annotations.length > 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setMediaPreview({
                          url: item.url,
                          type: item.type,
                          caption: item.caption,
                          annotations: item.annotations,
                        })
                      }
                      className="flex w-[165px] shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100 transition hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-slate-300"
                    >
                      <div className="relative h-[165px] w-full overflow-hidden bg-slate-100">
                      {isVideo ? (
                        <>
                          {isYouTubeUrl(item.url) ? (
                            <iframe
                              src={`${item.url}${item.url.includes('?') ? '&' : '?'}controls=0&modestbranding=1&playsinline=1&rel=0`}
                              title="Modulvideo"
                              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                              className="pointer-events-none h-full w-full"
                            />
                          ) : (
                            <video
                              className="h-full w-full bg-black object-cover"
                              muted
                              playsInline
                              preload="metadata"
                              controls={false}
                            >
                              <source src={item.url} />
                            </video>
                          )}
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                            <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-slate-900 shadow">
                              ▶
                            </span>
                          </div>
                        </>
                      ) : isDoc ? (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-slate-700">
                          <span className="text-4xl" role="img" aria-label="PDF">
                            📄
                          </span>
                          <span className="line-clamp-3 break-words text-xs font-semibold">
                            {getFileNameFromUrl(item.url)}
                          </span>
                        </div>
                      ) : hasAnnotationData ? (
                        <AnnotatedImage
                          src={item.url}
                          alt="Modulbilde"
                          annotations={item.annotations}
                          className="h-full w-full"
                        />
                      ) : (
                        <PreviewMediaImage src={item.url} alt="Modulbilde" className="h-full w-full object-contain" />
                      )}
                      </div>
                      {item.caption && (
                        <div className="w-full border-t border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-xs leading-snug text-slate-600">
                          {item.caption}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {summary && (
            <p className="mt-4 text-base text-slate-600">{summary}</p>
          )}
        </div>

      {bodyHtmlWithExternalLinks && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <h2 className="text-xl font-semibold text-slate-900">{L.content}</h2>
          <div
            className="prose prose-slate mt-4 max-w-none"
            dangerouslySetInnerHTML={{ __html: bodyHtmlWithExternalLinks }}
          />
        </section>
      )}

      {questions.length > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">{L.quizHeading}</h2>
            <span className="text-sm text-slate-500">
              {showSummary
                ? L.summary
                : L.questionCounter(currentIndex + 1, questions.length)}
            </span>
          </div>
          {showSummary ? (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
                <p>
                  {L.scoreText(
                    questions.length - incorrectQuestions.length,
                    questions.length,
                    scorePercentage,
                  )}
                </p>
                {isExamModule && (
                  <p className="mt-2 text-sm font-semibold">
                    {hasPassed ? L.examPassed : L.examFailed(requiredPercentage)}
                  </p>
                )}
              </div>
              {incorrectQuestions.length > 0 ? (
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-slate-700">{L.reviewPrompt}</p>
                  {incorrectQuestions.map((question) => {
                    const questionText = getLocalizedValue(question.contentText, locale);
                    const correctIds = getCorrectAnswerIds(question);
                    const correctAlternatives = question.alternatives.filter((alt) =>
                      correctIds.includes(alt.id),
                    );
                    const selectedIds = answers[question.id] ?? [];
                    const userAlternatives = question.alternatives.filter((alt) =>
                      selectedIds.includes(alt.id),
                    );
                    const userAnswerText = userAlternatives.length
                      ? userAlternatives
                          .map((alt) => getAlternativeLabel(alt, locale, L.alternativeFallback))
                          .join(', ')
                      : '—';
                    const correctAnswerText = correctAlternatives
                      .map((alt) => getAlternativeLabel(alt, locale, L.alternativeFallback))
                      .join(', ');
                    return (
                      <div
                        key={question.id}
                        className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4"
                      >
                        <p className="text-base font-semibold text-red-700">
                          {questionText || L.questionFallback}
                        </p>
                        <p className="mt-2 text-sm text-red-600">
                          {L.yourAnswer} {userAnswerText}
                        </p>
                        {correctAnswerText && (
                          <p className="text-sm text-slate-600">
                            {L.correctAnswer} {correctAnswerText}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
                  {L.allCorrect}
                </div>
              )}
              {incorrectQuestions.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={resetQuiz}
                    className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    {L.retakeQuiz}
                  </button>
                </div>
              )}
            </div>
          ) : currentQuestion ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-base font-semibold text-slate-700">
                  {getLocalizedValue(currentQuestion.contentText, locale) ||
                    L.questionFallback}
                </div>
                <div className="space-y-3">
                  {currentQuestion.alternatives.map((alt) => {
                    const label = getAlternativeLabel(
                      alt,
                      locale,
                      L.alternativeFallback,
                    );
                    const isSelected = (
                      answers[currentQuestion.id] ?? []
                    ).includes(alt.id);
                    return (
                      <button
                        key={alt.id}
                        onClick={() =>
                          handleSelectAlternative(currentQuestion, alt.id)
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
                    {L.previousQuestion}
                  </button>
                  <button
                    onClick={handleNext}
                    disabled={!(answers[currentQuestion.id]?.length ?? 0)}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {currentIndex === questions.length - 1
                      ? L.finishQuiz
                      : L.nextQuestion}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600">{L.noQuestions}</p>
            )}
          </section>
        )}

        {questions.length === 0 && (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm md:p-10">
            {L.noQuizYet}
          </div>
        )}
      </main>

      <Transition show={!!mediaPreview} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-50"
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
                    className="absolute right-4 top-4 z-10 rounded-full bg-white/80 p-2 text-slate-700 shadow hover:bg-white"
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
                            title="Modulmedia"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            className="h-[80vh] w-full"
                          />
                        ) : (
                          <video
                            controls
                            className="h-[80vh] w-full bg-black object-contain"
                          >
                            <source src={mediaPreview.url} />
                            {L.videoNotSupported}
                          </video>
                        )
                      ) : mediaPreview.type === 'document' ? (
                        <iframe
                          src={mediaPreview.url}
                          title="Moduldokument"
                          className="h-[80vh] w-full bg-white"
                        />
                      ) : previewImgError ? (
                        <div className="flex flex-col items-center justify-center gap-3 p-16 text-slate-400">
                          <span
                            className="text-5xl"
                            role="img"
                            aria-label="image missing"
                          >
                            🖼️
                          </span>
                        </div>
                      ) : mediaPreview.annotations?.length ? (
                        <div className="h-[85vh] w-full">
                          <AnnotatedImage
                            src={mediaPreview.url}
                            alt="Modulbilde"
                            annotations={mediaPreview.annotations}
                            className="h-full w-full"
                          />
                        </div>
                      ) : (
                        <Image
                          src={mediaPreview.url}
                          alt="Modulbilde"
                          width={0}
                          height={0}
                          sizes="100vw"
                          unoptimized
                          className="block object-contain"
                          style={{
                            width: 'auto',
                            height: 'auto',
                            maxWidth: '100%',
                            maxHeight: '85vh',
                          }}
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
    </>
  );
}
