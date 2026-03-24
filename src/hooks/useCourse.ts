'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import type { Course, CourseExpirationType, LocaleStringMap } from '@/types/course';

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

const normalizeExpirationType = (value: unknown): CourseExpirationType =>
  value === 'days' || value === 'months' || value === 'date' ? value : 'none';

const normalizeNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const normalizeDate = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : undefined;

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

interface UseCourseState {
  course: Course | null;
  loading: boolean;
  error: string | null;
}

export const useCourse = (courseId: string | null): UseCourseState => {
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) {
      setCourse(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const ref = doc(db, 'courses', courseId);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (!snapshot.exists()) {
          setCourse(null);
          setError('Fant ikke kurs');
        } else {
          const data = snapshot.data();
          setCourse({
            id: snapshot.id,
            companyId: data.companyId,
            createdById: data.createdById,
            title: normalizeLocaleMap(data.title),
            description: normalizeLocaleMap(data.description),
            courseImageUrl: data.courseImageUrl ?? null,
            status: data.status ?? 'inactive',
            languages: normalizeLanguages(data.languages),
            expirationType: normalizeExpirationType(data.expirationType),
            expirationDays: normalizeNumber(data.expirationDays),
            expirationMonths: normalizeNumber(data.expirationMonths),
            expirationDate: normalizeDate(data.expirationDate),
            createdAt: data.createdAt?.toDate?.() ?? undefined,
            updatedAt: data.updatedAt?.toDate?.() ?? undefined,
          });
          setError(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error('Failed to load course', err);
        setCourse(null);
        setError('Kunne ikke hente kurs');
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [courseId]);

  return { course, loading, error };
};

