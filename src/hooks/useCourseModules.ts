'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { normalizeModuleMediaMap, normalizeToPoolModel } from '@/utils/media';
import type {
  CourseModule,
  CourseModulePayload,
  CourseQuestion,
  CourseModuleType,
  LocaleStringArrayMap,
  LocaleStringMap,
  ModuleMediaPoolItem,
  ModuleMediaSelections,
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

const normalizeModuleStatus = (value: unknown): 'active' | 'inactive' =>
  value === 'inactive' ? 'inactive' : 'active';

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

interface UseCourseModulesState {
  modules: CourseModule[];
  loading: boolean;
  error: string | null;
  createModule: (payload: CourseModulePayload) => Promise<string>;
  updateModule: (id: string, payload: CourseModulePayload) => Promise<void>;
  deleteModule: (id: string) => Promise<void>;
}

export const useCourseModules = (
  courseId: string | null,
): UseCourseModulesState => {
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const modulesCollection = useMemo(() => {
    if (!courseId) return null;
    return collection(db, 'courses', courseId, 'modules');
  }, [courseId]);

  useEffect(() => {
    if (!modulesCollection || !courseId) {
      setModules([]);
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      query(modulesCollection),
      (snapshot) => {
        const next = snapshot.docs.map((docSnap, index) => {
          const data = docSnap.data();
          const orderValue = (() => {
            if (typeof data.order === 'number') return data.order;
            if (typeof data.order === 'string') {
              const parsed = Number(data.order);
              return Number.isFinite(parsed) ? parsed : index;
            }
            return index;
          })();
          const moduleType = normalizeModuleType(data.moduleType);
          const examPassPercentage =
            typeof data.examPassPercentage === 'number'
              ? data.examPassPercentage
              : undefined;
          const status = normalizeModuleStatus(data.status);
          const mediaSyncValue = typeof data.mediaSync === 'boolean' ? data.mediaSync : undefined;
          const media = normalizeModuleMediaMap(data.media, data.imageUrls, data.videoUrls);

          // Pool model: use stored pool if available, otherwise migrate from legacy
          let mediaPool: ModuleMediaPoolItem[] | undefined;
          let mediaSelections: ModuleMediaSelections | undefined;
          if (Array.isArray(data.mediaPool)) {
            mediaPool = data.mediaPool as ModuleMediaPoolItem[];
            mediaSelections = (data.mediaSelections ?? {}) as ModuleMediaSelections;
          } else {
            const migrated = normalizeToPoolModel(media, mediaSyncValue);
            mediaPool = migrated.pool;
            mediaSelections = migrated.selections;
          }

          return {
            id: docSnap.id,
            courseId,
            title: normalizeLocaleMap(data.title),
            summary: normalizeLocaleMap(data.summary),
            body: normalizeLocaleMap(data.body),
            media,
            videoUrls: normalizeLocaleArrayMap(data.videoUrls),
            imageUrls: normalizeLocaleArrayMap(data.imageUrls),
            order: orderValue,
            questions: Array.isArray(data.questions)
              ? (data.questions as CourseQuestion[]).map(normalizeQuestion)
              : [],
            languages: normalizeLanguages(data.languages),
            moduleType,
            examPassPercentage,
            mediaPool,
            mediaSelections,
            mediaSync: mediaSyncValue,
            status,
            createdAt: data.createdAt?.toDate?.() ?? undefined,
            updatedAt: data.updatedAt?.toDate?.() ?? undefined,
          } satisfies CourseModule;
        });

        next.sort((a, b) => {
          const orderDiff = (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
          if (orderDiff !== 0) {
            return orderDiff;
          }
          const createdDiff =
            (a.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (b.createdAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
          if (createdDiff !== 0) {
            return createdDiff;
          }
          return a.id.localeCompare(b.id);
        });

        setModules(next);
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error('Failed to load modules', err);
        setModules([]);
        setError('Kunne ikke hente emner');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [modulesCollection, courseId]);

  const createModule = useCallback(
    async (payload: CourseModulePayload) => {
      if (!modulesCollection) {
        throw new Error('Course is not selected');
      }
      const docRef = await addDoc(modulesCollection, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    },
    [modulesCollection],
  );

  const updateModule = useCallback(
    async (id: string, payload: CourseModulePayload) => {
      if (!courseId) {
        throw new Error('Course is not selected');
      }
      const moduleRef = doc(db, 'courses', courseId, 'modules', id);
      await updateDoc(moduleRef, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    },
    [courseId],
  );

  const deleteModule = useCallback(
    async (id: string) => {
      if (!courseId) {
        throw new Error('Course is not selected');
      }
      const moduleRef = doc(db, 'courses', courseId, 'modules', id);
      await deleteDoc(moduleRef);
    },
    [courseId],
  );

  return {
    modules,
    loading,
    error,
    createModule,
    updateModule,
    deleteModule,
  };
};

