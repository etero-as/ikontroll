'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useCourse } from '@/hooks/useCourse';
import { useCourseModule } from '@/hooks/useCourseModule';
import { useCourseProgress } from '@/hooks/useCourseProgress';
import { getLocalizedMediaItems } from '@/utils/media';
import type {
  CourseQuestion,
  CourseQuestionAlternative,
  LocaleStringArrayMap,
  LocaleStringMap,
} from '@/types/course';

const getPreferredLocale = (
  available: string[],
  requested: string | null,
): string => {
  if (!available.length) return requested ?? 'no';
  const normalizedRequested = requested?.slice(0, 2).toLowerCase();
  if (normalizedRequested && available.includes(normalizedRequested)) {
    return normalizedRequested;
  }
  const browserLang =
    typeof window !== 'undefined'
      ? window.navigator.language.slice(0, 2).toLowerCase()
      : null;
  const candidates = [normalizedRequested, browserLang, 'no', 'en'].filter(
    Boolean,
  ) as string[];
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

const isYouTubeUrl = (url: string): boolean =>
  /youtu\.be|youtube\.com/.test(url.toLowerCase());

const getAlternativeLabel = (
  alternative: CourseQuestionAlternative,
  locale: string,
) => getLocalizedValue(alternative.altText, locale) || 'Alternativ';

const DEFAULT_EXAM_PASS_PERCENTAGE = 80;
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

const getQuizButtonLabels = (locale: string) => {
  switch (locale) {
    case 'en':
      return {
        previous: 'Previous question',
        next: 'Next question',
        finish: 'Finish quiz',
        retry: 'Retake quiz',
        back: 'Back to course overview',
      };
    case 'it':
      return {
        previous: 'Domanda precedente',
        next: 'Domanda successiva',
        finish: 'Termina quiz',
        retry: 'Ricomincia il quiz',
        back: 'Torna alla panoramica del corso',
      };
    case 'sv':
      return {
        previous: 'Föregående fråga',
        next: 'Nästa fråga',
        finish: 'Avsluta quiz',
        retry: 'Gör om quizzen',
        back: 'Tillbaka till kursöversikten',
      };
    default:
      return {
        previous: 'Forrige spørsmål',
        next: 'Neste spørsmål',
        finish: 'Fullfør quiz',
        retry: 'Ta quizen på nytt',
        back: 'Tilbake til kursoversikt',
      };
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
      return 'Not completed';
    case 'it':
      return 'Non completato';
    case 'sv':
      return 'Inte slutförd';
    default:
      return 'Ikke fullført';
  }
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
  const { completedModules, setModuleCompletion } = useCourseProgress(courseId);

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
      question.alternatives.forEach((alternative) => {
        Object.keys(alternative.altText ?? {}).forEach((lang) => set.add(lang));
      });
    });
    if (course?.title) Object.keys(course.title).forEach((lang) => set.add(lang));
    return Array.from(set);
  }, [module, course]);

  const locale = useMemo(
    () => getPreferredLocale(availableLocales, requestedLang),
    [availableLocales, requestedLang],
  );

  const localizedMedia = getLocalizedMediaItems(module?.media, locale);
  const images = getLocalizedList(module?.imageUrls, locale);
  const videos = getLocalizedList(module?.videoUrls, locale);
  const mediaItems = localizedMedia.length
    ? localizedMedia
    : [
        ...images.map((url) => ({ id: url, url, type: 'image' as const })),
        ...videos.map((url) => ({ id: url, url, type: 'video' as const })),
      ];
  const moduleTitle = getLocalizedValue(module?.title, locale) || 'Emne';
  const summary = getLocalizedValue(module?.summary, locale);
  const bodyHtml = getLocalizedValue(module?.body, locale);
  const questions = module?.questions ?? [];
  const isModuleCompleted = completedModules.includes(moduleId);
  const quizLabels = getQuizButtonLabels(locale);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [showSummary, setShowSummary] = useState(false);

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
    setAnswers({});
    setCurrentIndex(0);
    setShowSummary(false);
  };

  const incorrectQuestions = useMemo(
    () =>
      questions.filter(
        (question) => !isQuestionAnswerCorrect(question, answers[question.id]),
      ),
    [questions, answers],
  );

  const moduleType = module?.moduleType === 'exam' ? 'exam' : 'normal';
  const isExamModule = moduleType === 'exam';
  const scorePercentage = questions.length
    ? Math.round(
        ((questions.length - incorrectQuestions.length) / questions.length) * 100,
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
    if (!module?.id || !showSummary || questions.length === 0) {
      return;
    }
    (async () => {
      try {
        await setModuleCompletion(module.id, hasPassed);
      } catch (err) {
        console.error('Failed to update module progress', err);
      }
    })();
  }, [
    module?.id,
    showSummary,
    hasPassed,
    questions.length,
    setModuleCompletion,
  ]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Laster emne …
      </div>
    );
  }

  if (error || !module) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-red-100 bg-red-50 px-6 py-4 text-sm text-red-600">
          {error ?? 'Fant ikke emne'}
        </div>
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-4 pb-12 pt-10 md:px-8">
      <header className="space-y-6">
        <button
          onClick={() => router.push(`/courses/${courseId}/preview?lang=${locale}`)}
          className="text-sm font-semibold text-slate-500 transition hover:text-slate-900"
        >
          ← Tilbake til kursoversikt
        </button>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Emne
            </p>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                isModuleCompleted
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {getModuleStatusLabel(locale, isModuleCompleted)}
            </span>
          </div>
          <h1 className="text-3xl font-semibold text-slate-900 sm:text-4xl">
            {moduleTitle}
          </h1>
          {summary && <p className="mt-3 text-base text-slate-600">{summary}</p>}
        </div>
      </header>

      {mediaItems.length > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <h2 className="text-xl font-semibold text-slate-900">Mediegalleri</h2>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            {mediaItems.map((item) =>
              item.type === 'image' ? (
                <div
                  key={item.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 h-64"
                >
                  <img src={item.url} alt="Modulbilde" className="h-full w-full object-contain" />
                </div>
              ) : (
                <div
                  key={item.id}
                  className="relative overflow-hidden rounded-2xl border border-slate-200 bg-black"
                >
                  {isYouTubeUrl(item.url) ? (
                    <iframe
                      src={item.url}
                      title="Modulvideo"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="aspect-video w-full"
                    />
                  ) : (
                    <video controls className="aspect-video w-full">
                      <source src={item.url} />
                      Nettleseren din støtter ikke video.
                    </video>
                  )}
                </div>
              ),
            )}
          </div>
        </section>
      )}

      {bodyHtml && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <h2 className="text-xl font-semibold text-slate-900">Innhold</h2>
          <div
            className="prose prose-slate mt-4 max-w-none"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        </section>
      )}

      {questions.length > 0 && (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-slate-900">Kontrollspørsmål</h2>
            <span className="text-sm text-slate-500">
              {showSummary
                ? 'Oppsummering'
                : `Spørsmål ${currentIndex + 1} av ${questions.length}`}
            </span>
          </div>

          {showSummary ? (
            <div className="space-y-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600">
                <p>
                  Du fikk {questions.length - incorrectQuestions.length} av{' '}
                  {questions.length} riktige ({scorePercentage}%).
                </p>
                {isExamModule && (
                  <p className="mt-2 text-sm font-semibold">
                    {hasPassed
                      ? 'Eksamen bestått.'
                      : `Eksamen ikke bestått. Krav: ${requiredPercentage}%.`}
                  </p>
                )}
              </div>
              {incorrectQuestions.length > 0 ? (
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-slate-700">
                    Spørsmål du bør se gjennom igjen:
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
                        <p className="text-sm font-semibold text-red-700">
                          {questionText || 'Spørsmål'}
                        </p>
                        <p className="mt-2 text-sm text-red-600">
                          Ditt svar: {userAnswerText}
                        </p>
                        {correctAnswerText && (
                          <p className="text-sm text-slate-600">
                            Riktig svar: {correctAnswerText}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
                  Flott! Du svarte riktig på alle spørsmål.
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={resetQuiz}
                  className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  {quizLabels.retry}
                </button>
                <button
                  onClick={() => router.push(`/courses/${courseId}/preview?lang=${locale}`)}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  {quizLabels.back}
                </button>
              </div>
            </div>
          ) : currentQuestion ? (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-700">
                {getLocalizedValue(currentQuestion.contentText, locale) ||
                  'Spørsmål'}
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
                  {quizLabels.previous}
                </button>
                <button
                  onClick={handleNext}
                  disabled={!(answers[currentQuestion.id]?.length ?? 0)}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {currentIndex === questions.length - 1
                    ? quizLabels.finish
                    : quizLabels.next}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600">Ingen spørsmål er tilgjengelige.</p>
          )}
        </section>
      )}

      {questions.length === 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm md:p-10">
          Dette emnet har ikke kontrollspørsmål ennå.
        </div>
      )}
    </main>
  );
}
