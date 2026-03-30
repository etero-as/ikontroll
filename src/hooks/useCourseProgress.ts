'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc } from 'firebase/firestore';

import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';

interface CourseProgressState {
  completedModules: string[];
  moduleAnsweredCounts: Record<string, number>;
  moduleAnswers: Record<string, Record<string, string[]>>;
  loading: boolean;
  error: string | null;
  setModuleCompletion: (moduleId: string, isComplete: boolean) => Promise<void>;
  saveModuleAnsweredCount: (moduleId: string, count: number) => Promise<void>;
  saveModuleAnswers: (moduleId: string, answers: Record<string, string[]>) => Promise<void>;
}

export const useCourseProgress = (courseId: string | null): CourseProgressState => {
  const { firebaseUser } = useAuth();
  const [completedModules, setCompletedModules] = useState<string[]>([]);
  const [moduleAnsweredCounts, setModuleAnsweredCounts] = useState<Record<string, number>>({});
  const [moduleAnswers, setModuleAnswers] = useState<Record<string, Record<string, string[]>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const completedModulesRef = useRef<string[]>([]);
  const moduleAnsweredCountsRef = useRef<Record<string, number>>({});
  const moduleAnswersRef = useRef<Record<string, Record<string, string[]>>>({});

  useEffect(() => {
    if (!courseId || !firebaseUser?.uid) {
      const timer = setTimeout(() => {
        setCompletedModules([]);
        completedModulesRef.current = [];
        setModuleAnsweredCounts({});
        moduleAnsweredCountsRef.current = {};
        setModuleAnswers({});
        moduleAnswersRef.current = {};
        setLoading(false);
        setError(null);
      }, 0);
      return () => clearTimeout(timer);
    }

    const progressRef = doc(db, 'users', firebaseUser.uid, 'courseProgress', courseId);
    const loadingTimer = setTimeout(() => {
      setLoading(true);
    }, 0);

    const unsubscribe = onSnapshot(
      progressRef,
      (snapshot) => {
        const data = snapshot.data();
        const modules = ((data?.completedModules as string[]) ?? []).filter(Boolean);
        setCompletedModules(modules);
        completedModulesRef.current = modules;
        const counts = (data?.moduleAnsweredCounts as Record<string, number>) ?? {};
        setModuleAnsweredCounts(counts);
        moduleAnsweredCountsRef.current = counts;
        const answers = (data?.moduleAnswers as Record<string, Record<string, string[]>>) ?? {};
        setModuleAnswers(answers);
        moduleAnswersRef.current = answers;
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error('Failed to load course progress', err);
        setCompletedModules([]);
        setModuleAnsweredCounts({});
        setModuleAnswers({});
        setError('Kunne ikke hente kursfremdrift.');
        setLoading(false);
      },
    );

    return () => {
      clearTimeout(loadingTimer);
      unsubscribe();
    };
  }, [courseId, firebaseUser?.uid]);

  useEffect(() => {
    completedModulesRef.current = completedModules;
  }, [completedModules]);

  useEffect(() => {
    moduleAnsweredCountsRef.current = moduleAnsweredCounts;
  }, [moduleAnsweredCounts]);

  useEffect(() => {
    moduleAnswersRef.current = moduleAnswers;
  }, [moduleAnswers]);

  const setModuleCompletion = useCallback(
    async (moduleId: string, isComplete: boolean) => {
      if (!courseId || !firebaseUser?.uid || !moduleId) {
        return;
      }

      const progressRef = doc(db, 'users', firebaseUser.uid, 'courseProgress', courseId);
      const current = completedModulesRef.current ?? [];
      const nextModules = isComplete
        ? Array.from(new Set([...current, moduleId]))
        : current.filter((id) => id !== moduleId);

      // Avoid redundant writes if nothing actually changed
      const changed =
        current.length !== nextModules.length ||
        current.some((id, index) => id !== nextModules[index]);
      if (!changed) {
        return;
      }

      setCompletedModules(nextModules);
      completedModulesRef.current = nextModules;

      try {
        await setDoc(
          progressRef,
          {
            courseId,
            updatedAt: serverTimestamp(),
            completedModules: nextModules,
          },
          { merge: true },
        );
        setError(null);
      } catch (err) {
        console.error('Failed to update module progress', err);
        completedModulesRef.current = current;
        setCompletedModules(current);
        setError('Kunne ikke oppdatere fremdrift.');
        throw err;
      }
    },
    [courseId, firebaseUser],
  );

  const saveModuleAnsweredCount = useCallback(
    async (moduleId: string, count: number) => {
      if (!courseId || !firebaseUser?.uid || !moduleId) return;

      const current = moduleAnsweredCountsRef.current;
      if ((current[moduleId] ?? 0) >= count) return;

      const next = { ...current, [moduleId]: count };
      setModuleAnsweredCounts(next);
      moduleAnsweredCountsRef.current = next;

      const progressRef = doc(db, 'users', firebaseUser.uid, 'courseProgress', courseId);
      try {
        await setDoc(
          progressRef,
          {
            courseId,
            updatedAt: serverTimestamp(),
            moduleAnsweredCounts: next,
          },
          { merge: true },
        );
      } catch (err) {
        console.error('Failed to save module answered count', err);
        moduleAnsweredCountsRef.current = current;
        setModuleAnsweredCounts(current);
        throw err;
      }
    },
    [courseId, firebaseUser],
  );

  const saveModuleAnswers = useCallback(
    async (moduleId: string, answers: Record<string, string[]>) => {
      if (!courseId || !firebaseUser?.uid || !moduleId) return;

      const currentAnswers = moduleAnswersRef.current;
      const prevForModule = currentAnswers[moduleId] ?? {};
      const prevKeys = Object.keys(prevForModule).sort();
      const newKeys = Object.keys(answers).sort();
      const changed =
        prevKeys.length !== newKeys.length ||
        newKeys.some((k) => {
          const prev = (prevForModule[k] ?? []).slice().sort();
          const next = (answers[k] ?? []).slice().sort();
          return prev.length !== next.length || prev.some((id, i) => id !== next[i]);
        });
      if (!changed) return;

      const nextAnswers = { ...currentAnswers, [moduleId]: answers };
      const count = newKeys.length;
      const nextCounts = { ...moduleAnsweredCountsRef.current, [moduleId]: count };

      setModuleAnswers(nextAnswers);
      moduleAnswersRef.current = nextAnswers;
      setModuleAnsweredCounts(nextCounts);
      moduleAnsweredCountsRef.current = nextCounts;

      const progressRef = doc(db, 'users', firebaseUser.uid, 'courseProgress', courseId);
      try {
        await setDoc(
          progressRef,
          {
            courseId,
            updatedAt: serverTimestamp(),
            moduleAnswers: nextAnswers,
            moduleAnsweredCounts: nextCounts,
          },
          { merge: true },
        );
      } catch (err) {
        console.error('Failed to save module answers', err);
        moduleAnswersRef.current = currentAnswers;
        setModuleAnswers(currentAnswers);
        moduleAnsweredCountsRef.current = moduleAnsweredCountsRef.current;
        setModuleAnsweredCounts(moduleAnsweredCountsRef.current);
        throw err;
      }
    },
    [courseId, firebaseUser],
  );

  return {
    completedModules,
    moduleAnsweredCounts,
    moduleAnswers,
    loading,
    error,
    setModuleCompletion,
    saveModuleAnsweredCount,
    saveModuleAnswers,
  };
};

export interface UserCourseProgress {
  courseId: string;
  completedModules: string[];
}

export const useAllCourseProgress = () => {
  const { firebaseUser } = useAuth();
  const [progress, setProgress] = useState<UserCourseProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firebaseUser?.uid) {
      const timer = setTimeout(() => {
        setLoading(false);
        setProgress([]);
      }, 0);
      return () => clearTimeout(timer);
    }

    const q = query(collection(db, 'users', firebaseUser.uid, 'courseProgress'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const results: UserCourseProgress[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          results.push({
            courseId: doc.id,
            completedModules: Array.isArray(data.completedModules) ? data.completedModules : [],
          });
        });
        setProgress(results);
        setLoading(false);
      },
      (error) => {
        console.error('Failed to fetch all course progress', error);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [firebaseUser?.uid]);

  return { progress, loading };
};
