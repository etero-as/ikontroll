'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { normalizeModuleMediaMap } from '@/utils/media';
import type {
  CourseModule,
  CourseQuestion,
  CourseModuleType,
  LocaleStringArrayMap,
  LocaleStringMap,
} from '@/types/course';
const normalizeLocaleMap = (value: unknown): LocaleStringMap => {
  if (!value) {
    return { no: '' };
  }
  if (typeof value === 'string') {
    return { no: value };
  }
  if (typeof value === 'object') {
    return value as LocaleStringMap;
  }
  return { no: String(value) };
};

const normalizeLocaleArrayMap = (value: unknown): LocaleStringArrayMap => {
  if (!value) {
    return { no: [] };
  }
  if (Array.isArray(value)) {
    return { no: value.filter((item): item is string => typeof item === 'string') };
  }
  if (typeof value === 'object') {
    const result: LocaleStringArrayMap = {};
    Object.entries(value as Record<string, unknown>).forEach(([lang, entries]) => {
      if (Array.isArray(entries)) {
        result[lang] = entries.filter((item): item is string => typeof item === 'string');
      } else if (typeof entries === 'string') {
        result[lang] = [entries];
      } else if (entries == null) {
        result[lang] = [];
      } else {
        result[lang] = [String(entries)];
      }
    });
    return result;
  }
  return { no: [String(value)] };
};

const normalizeModuleType = (value: unknown): CourseModuleType =>
  value === 'exam' ? 'exam' : 'normal';

const normalizeLanguages = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const next = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  if (!next.length) {
    return undefined;
  }
  return Array.from(new Set(next));
};

const normalizeQuestion = (question: CourseQuestion): CourseQuestion => {
  const alternatives = Array.isArray(question.alternatives)
    ? question.alternatives
    : [];
  const altIds = alternatives.map((alt) => alt.id).filter(Boolean);
  const rawCorrectIds = Array.isArray(question.correctAnswerIds)
    ? question.correctAnswerIds.filter(
        (id): id is string => typeof id === 'string' && altIds.includes(id),
      )
    : [];
  const fallbackId =
    typeof question.correctAnswerId === 'string' && altIds.includes(question.correctAnswerId)
      ? question.correctAnswerId
      : null;
  const correctAnswerIds =
    rawCorrectIds.length > 0
      ? rawCorrectIds
      : fallbackId
        ? [fallbackId]
        : altIds.length
          ? [altIds[0]]
          : [];
  return {
    ...question,
    alternatives,
    correctAnswerIds,
    correctAnswerId: correctAnswerIds[0] ?? fallbackId ?? undefined,
  };
};

interface UseCourseModuleState {
  module: CourseModule | null;
  loading: boolean;
  error: string | null;
}

export const useCourseModule = (
  courseId: string | null,
  moduleId: string | null,
): UseCourseModuleState => {
  const [module, setModule] = useState<CourseModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId || !moduleId) {
      setModule(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const ref = doc(db, 'courses', courseId, 'modules', moduleId);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (!snapshot.exists()) {
          setModule(null);
          setError('Fant ikke emnet');
        } else {
          const data = snapshot.data();
          const moduleType = normalizeModuleType(data.moduleType);
          const examPassPercentage =
            typeof data.examPassPercentage === 'number'
              ? data.examPassPercentage
              : undefined;
          setModule({
            id: snapshot.id,
            courseId,
            title: normalizeLocaleMap(data.title),
            summary: normalizeLocaleMap(data.summary),
            body: normalizeLocaleMap(data.body),
            media: normalizeModuleMediaMap(data.media, data.imageUrls, data.videoUrls),
            videoUrls: normalizeLocaleArrayMap(data.videoUrls),
            imageUrls: normalizeLocaleArrayMap(data.imageUrls),
            order: data.order ?? 0,
            questions: Array.isArray(data.questions)
              ? (data.questions as CourseQuestion[]).map(normalizeQuestion)
              : [],
            languages: normalizeLanguages(data.languages),
            moduleType,
            examPassPercentage,
            mediaSync: typeof data.mediaSync === 'boolean' ? data.mediaSync : undefined,
            createdAt: data.createdAt?.toDate?.() ?? undefined,
            updatedAt: data.updatedAt?.toDate?.() ?? undefined,
          });
          setError(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error('Failed to load module', err);
        setModule(null);
        setError('Kunne ikke hente emnet');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [courseId, moduleId]);

  return { module, loading, error };
};


