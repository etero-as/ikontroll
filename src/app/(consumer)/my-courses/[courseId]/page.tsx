'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

import ConsumerCourseView from '@/components/consumer/ConsumerCourseView';
import { useCourseModules } from '@/hooks/useCourseModules';
import { useCourse } from '@/hooks/useCourse';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';

export default function ConsumerCourseDetailPage() {
  const params = useParams();
  const courseId = params.courseId as string;
  const router = useRouter();
  const { profile, activeCustomerId, setActiveCustomerId } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);

  const memberships = (profile?.customerMemberships ?? []).filter(
    (membership) => (membership.assignedCourseIds ?? []).includes(courseId),
  );

  useEffect(() => {
    if (!memberships.length) {
      return;
    }
    if (!activeCustomerId || !memberships.some((m) => m.customerId === activeCustomerId)) {
      setActiveCustomerId(memberships[0].customerId);
    }
  }, [activeCustomerId, memberships, setActiveCustomerId]);

  const { course, loading: courseLoading, error: courseError } = useCourse(courseId);
  const { modules, loading: modulesLoading, error: modulesError } = useCourseModules(courseId);

  if (courseLoading || modulesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        {t.common.loading}
      </div>
    );
  }

  if (!memberships.length) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="space-y-4 rounded-2xl border border-red-100 bg-red-50 px-6 py-4 text-center text-sm text-red-600">
          <p>{t.courses.noAccessToCourse}</p>
          <button
            onClick={() => router.replace('/my-courses')}
            className="rounded-full bg-red-600 px-4 py-2 text-white transition hover:bg-red-500"
          >
            {t.courses.backToMyCourses}
          </button>
        </div>
      </div>
    );
  }

  if (courseError || modulesError || !course) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-red-100 bg-red-50 px-6 py-4 text-sm text-red-600">
          {courseError ?? modulesError ?? t.courses.courseNotFound}
        </div>
      </div>
    );
  }

  return (
    <ConsumerCourseView
      course={course}
      modules={modules.filter((m) => (m.status ?? 'active') === 'active')}
      basePath="/my-courses"
    />
  );
}
