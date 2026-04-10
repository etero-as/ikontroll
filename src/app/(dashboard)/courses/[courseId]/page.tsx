'use client';

import { useParams } from 'next/navigation';

import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import CourseDetailManager from '../CourseDetailManager';

export default function CourseDetailPage() {
  const params = useParams<{ courseId?: string | string[] }>();
  const courseParam = params?.courseId;
  const courseId = Array.isArray(courseParam) ? courseParam[0] : courseParam ?? null;
  const { locale } = useLocale();
  const t = getTranslation(locale);

  if (!courseId) {
    return (
      <section className="space-y-6">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          {t.admin.courseDetail.courseNotFound}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <CourseDetailManager courseId={courseId} />
    </section>
  );
}

