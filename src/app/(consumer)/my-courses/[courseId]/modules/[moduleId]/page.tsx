'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

import ConsumerModuleView from '@/components/consumer/ConsumerModuleView';
import { useCourse } from '@/hooks/useCourse';
import { useCourseModule } from '@/hooks/useCourseModule';
import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';

export default function ConsumerModuleDetailPage() {
  const params = useParams();
  const courseId = params.courseId as string;
  const moduleId = params.moduleId as string;
  const router = useRouter();
  const { profile, activeCustomerId, setActiveCustomerId } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);

  const memberships = (profile?.customerMemberships ?? []).filter(
    (membership) => (membership.assignedCourseIds ?? []).includes(courseId),
  );

  useEffect(() => {
    if (!memberships.length) return;
    if (!activeCustomerId || !memberships.some((m) => m.customerId === activeCustomerId)) {
      setActiveCustomerId(memberships[0].customerId);
    }
  }, [activeCustomerId, memberships, setActiveCustomerId]);

  const { course, loading: courseLoading, error: courseError } = useCourse(courseId);
  const { module, loading: moduleLoading, error: moduleError } = useCourseModule(
    courseId,
    moduleId,
  );

  if (courseLoading || moduleLoading) {
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
          <p>{t.modules.noAccessToModule}</p>
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

  if (courseError || moduleError || !course || !module) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl border border-red-100 bg-red-50 px-6 py-4 text-sm text-red-600">
          {courseError ?? moduleError ?? t.modules.moduleNotFound}
        </div>
      </div>
    );
  }

  return <ConsumerModuleView course={course} module={module} basePath="/my-courses" />;
}

