'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';

type ModuleCountMap = Record<string, number>;

export const useCourseModuleCounts = (courseIds: string[]): ModuleCountMap => {
  const [counts, setCounts] = useState<ModuleCountMap>({});
  const sortedIds = useMemo(() => [...courseIds].sort(), [courseIds]);

  useEffect(() => {
    if (!sortedIds.length) {
      setCounts({});
      return;
    }

    const unsubscribes = sortedIds.map((courseId) => {
      const modulesRef = collection(db, 'courses', courseId, 'modules');
      return onSnapshot(
        modulesRef,
        (snapshot) => {
          setCounts((prev) => ({
            ...prev,
            [courseId]: snapshot.size,
          }));
        },
        (err) => {
          console.error(`Failed to load modules for course ${courseId}`, err);
        },
      );
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [sortedIds]);

  return useMemo(() => counts, [counts]);
};





