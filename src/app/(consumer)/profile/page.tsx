'use client';

import { useMemo, useState, useEffect } from 'react';
import { GraduationCap } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { useAllCourseProgress } from '@/hooks/useCourseProgress';
import { useConsumerCourses } from '@/hooks/useConsumerCourses';
import { useCourseModules } from '@/hooks/useCourseModules';
import type { Course } from '@/types/course';
import { getLocalizedValue } from '@/utils/localization';
import { getTranslation } from '@/utils/translations';
import { useLocale } from '@/context/LocaleContext';

export default function ProfilePage() {
  const { profile } = useAuth();
  const { locale } = useLocale();
  
  const { progress, loading: progressLoading } = useAllCourseProgress();
  
  const candidateCourseIds = useMemo(() => {
    return progress
      .filter(p => p.completedModules.length > 0)
      .map(p => p.courseId);
  }, [progress]);

  const { courses, loading: coursesLoading } = useConsumerCourses(candidateCourseIds);


  const t = getTranslation(locale);

  if (progressLoading || coursesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 pb-10">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-900 text-3xl font-bold text-white shadow-lg">
          {profile?.firstName?.[0]}
          {profile?.lastName?.[0]}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {profile?.firstName} {profile?.lastName}
          </h1>
          <p className="text-slate-500">{profile?.email}</p>
        </div>
      </div>

      <div className="w-full max-w-2xl space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-10">
        <h2 className="text-xl font-semibold text-slate-900">{t.profile.completedCourses}</h2>
        
        <CompletedCoursesList 
          courses={courses} 
          progressMap={Object.fromEntries(progress.map(p => [p.courseId, p.completedModules]))}
          locale={locale} 
        />
      </div>
    </div>
  );
}

function CompletedCoursesList({ 
  courses, 
  progressMap, 
  locale 
}: { 
  courses: Course[]; 
  progressMap: Record<string, string[]>; 
  locale: string 
}) {
  const [verifiedCompletedIds, setVerifiedCompletedIds] = useState<string[]>([]);
  const [checkedCount, setCheckedCount] = useState(0);
  
  const handleVerification = (courseId: string, isCompleted: boolean) => {
    if (isCompleted) {
      setVerifiedCompletedIds(prev => {
        if (prev.includes(courseId)) return prev;
        return [...prev, courseId];
      });
    }
    setCheckedCount(prev => prev + 1);
  };

  const isLoading = checkedCount < courses.length;
  const hasCompletedCourses = verifiedCompletedIds.length > 0;

  if (courses.length === 0) {
     return <EmptyState locale={locale} />;
  }

  return (
    <>
      {isLoading && (
        <div className="py-4 text-center text-sm text-slate-400 animate-pulse">
          Sjekker fullførte kurs...
        </div>
      )}
      
      {!isLoading && !hasCompletedCourses && <EmptyState locale={locale} />}

      <div className={!hasCompletedCourses && !isLoading ? 'hidden' : 'space-y-4'}>
        {courses.map(course => (
          <CompletedCourseChecker
            key={course.id}
            course={course}
            completedModules={progressMap[course.id] || []}
            onVerify={handleVerification}
            locale={locale}
          />
        ))}
      </div>
    </>
  );
}

function EmptyState({ locale }: { locale: string }) {
    const t = getTranslation(locale);
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center text-slate-500">
            <div className="rounded-full bg-slate-100 p-4">
                <GraduationCap className="h-8 w-8 text-slate-400" />
            </div>
            <p>{t.profile.noCompletedCourses}</p>
        </div>
    )
}

function CompletedCourseChecker({ 
  course, 
  completedModules, 
  onVerify, 
  locale 
}: { 
  course: Course; 
  completedModules: string[]; 
  onVerify: (id: string, isCompleted: boolean) => void; 
  locale: string;
}) {
  const { modules, loading } = useCourseModules(course.id);
  const t = getTranslation(locale);

  useEffect(() => {
    if (!loading && modules) {
        const totalModules = modules.length;
        const validCompletedCount = modules.filter(m => completedModules.includes(m.id)).length;
        
        const isCompleted = totalModules > 0 && validCompletedCount === totalModules;
        onVerify(course.id, isCompleted);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, modules]); 

  if (loading || !modules) return null;

  const totalModules = modules.length;
  const validCompletedCount = modules.filter(m => completedModules.includes(m.id)).length;
  const isCompleted = totalModules > 0 && validCompletedCount === totalModules;

  if (!isCompleted) return null;

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
      <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-emerald-100 text-2xl">
        🏆
      </div>
      <div>
        <h3 className="font-semibold text-slate-900">
          {getLocalizedValue(course.title, locale)}
        </h3>
        <p className="text-xs text-emerald-700">
           {t.courses.completed}
        </p>
      </div>
    </div>
  );
}
