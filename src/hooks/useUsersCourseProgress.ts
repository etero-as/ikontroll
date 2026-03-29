'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';

import { db } from '@/lib/firebase';

export type UsersCourseProgressMap = Record<string, Record<string, string[]>>;

export const useUsersCourseProgress = (userIds: string[]): UsersCourseProgressMap => {
  const [progressMap, setProgressMap] = useState<UsersCourseProgressMap>({});
  const sortedIds = useMemo(() => [...userIds].sort(), [userIds]);

  useEffect(() => {
    if (!sortedIds.length) {
      setProgressMap({});
      return;
    }

    const unsubscribes = sortedIds.map((userId) => {
      const progressRef = collection(db, 'users', userId, 'courseProgress');
      return onSnapshot(
        progressRef,
        (snapshot) => {
          setProgressMap((prev) => {
            const next: UsersCourseProgressMap = { ...prev };
            next[userId] = {};
            snapshot.forEach((docSnap) => {
              const data = docSnap.data();
              const completedModules = Array.isArray(data.completedModules)
                ? data.completedModules.filter((entry): entry is string => typeof entry === 'string')
                : [];
              next[userId][docSnap.id] = completedModules;
            });
            return next;
          });
        },
        (err) => {
          console.error(`Failed to load progress for user ${userId}`, err);
        },
      );
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [sortedIds]);

  return useMemo(() => progressMap, [progressMap]);
};





