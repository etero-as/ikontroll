'use client';

import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import Link from 'next/link';
import DuplicateButton from '@/components/DuplicateButton';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

import { useAuth } from '@/context/AuthContext';
import { useCourses } from '@/hooks/useCourses';
import { db } from '@/lib/firebase';
import { useLocale } from '@/context/LocaleContext';
import { getTranslation } from '@/utils/translations';
import type {
  Course,
  CourseExpirationType,
  CoursePayload,
  CourseStatus,
  LocaleStringMap,
} from '@/types/course';
import CourseExpirationFields from '@/components/course/CourseExpirationFields';

type CourseFormValues = {
  title: string;
  description?: string;
  status: CourseStatus;
  expirationType: CourseExpirationType;
  expirationAmount?: number;
  expirationDate?: string;
};

type DuplicateCourseFormValues = {
  title: string;
};

const STATUS_STYLES: Record<CourseStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-600',
};

const getLocaleValue = (map: LocaleStringMap | undefined, lang = 'no') => {
  if (!map) return '';
  if (map[lang]) return map[lang];
  const firstEntry = Object.values(map).find((value) => value?.trim());
  return firstEntry ?? '';
};

const normalizeLocaleMap = (value: unknown): LocaleStringMap => {
  if (!value) return { no: '' };
  if (typeof value === 'string') return { no: value };
  if (typeof value === 'object') return value as LocaleStringMap;
  return { no: String(value) };
};

const normalizeLanguages = (value: unknown): string[] => {
  if (!Array.isArray(value)) return ['no'];
  const next = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  if (!next.length) return ['no'];
  return Array.from(new Set(next));
};

export default function CourseManager() {
  const router = useRouter();
  const { companyId, profile } = useAuth();
  const { courses, loading, error, createCourse, deleteCourse } = useCourses(companyId ?? null);
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<Course | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  const buildDuplicateTitle = (course: Course | null) => {
    if (!course) return '';
    const baseTitle = getLocaleValue(course.title).trim();
    if (!baseTitle) return t.admin.courses.copyOfCourse;
    return t.admin.courses.copyOf(baseTitle);
  };

  const resolveExpirationFields = (values: CourseFormValues) => {
    const expirationType = values.expirationType ?? 'none';
    const amount =
      typeof values.expirationAmount === 'number' && Number.isFinite(values.expirationAmount)
        ? Math.max(1, Math.round(values.expirationAmount))
        : null;
    const expirationDate = values.expirationDate?.trim() || null;

    if (expirationType === 'days') {
      return { expirationType, expirationDays: amount, expirationMonths: null, expirationDate: null };
    }
    if (expirationType === 'months') {
      return { expirationType, expirationDays: null, expirationMonths: amount, expirationDate: null };
    }
    if (expirationType === 'date') {
      return { expirationType, expirationDays: null, expirationMonths: null, expirationDate };
    }
    return { expirationType: 'none' as const, expirationDays: null, expirationMonths: null, expirationDate: null };
  };

  const handleCreateCourse = async (values: CourseFormValues) => {
    if (!companyId || !profile) {
      setFormError(t.admin.courses.missingCompanyContext);
      return;
    }
    try {
      const expirationFields = resolveExpirationFields(values);
      const payload: CoursePayload = {
        companyId,
        createdById: profile.id,
        title: { no: values.title.trim() },
        description: { no: (values.description ?? '').trim() },
        status: values.status,
        languages: ['no'],
        ...expirationFields,
      };
      const id = await createCourse(payload);
      setCreateOpen(false);
      router.push(`/courses/${id}`);
    } catch (err) {
      console.error('Failed to create course', err);
      setFormError(err instanceof Error ? err.message : t.admin.courses.createError);
    }
  };

  const handleDeleteCourse = async (course: Course) => {
    const confirmed = window.confirm(
      t.admin.courses.deleteConfirm(getLocaleValue(course.title) || t.admin.courses.untitled),
    );
    if (!confirmed) return;
    try {
      await deleteCourse(course.id);
    } catch (err) {
      console.error('Failed to delete course', err);
      alert(t.admin.courses.deleteError);
    }
  };

  const handleDuplicateCourse = async (values: DuplicateCourseFormValues) => {
    if (!duplicateTarget) return;
    if (!companyId || !profile) {
      setDuplicateError(t.admin.courses.missingCompanyContext);
      return;
    }
    try {
      const trimmedTitle = values.title.trim();
      if (!trimmedTitle) {
        setDuplicateError(t.admin.courses.titleRequired);
        return;
      }
      setDuplicating(true);
      setDuplicateError(null);

      const sourceRef = doc(db, 'courses', duplicateTarget.id);
      const sourceSnap = await getDoc(sourceRef);
      if (!sourceSnap.exists()) {
        setDuplicateError(t.admin.courses.duplicateNotFound);
        return;
      }
      const sourceData = sourceSnap.data();
      const nextTitle = { ...normalizeLocaleMap(sourceData.title), no: trimmedTitle };
      const nextLanguages = normalizeLanguages(sourceData.languages);

      const newCourseRef = await addDoc(collection(db, 'courses'), {
        ...sourceData,
        title: nextTitle,
        languages: nextLanguages,
        companyId,
        createdById: profile.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const modulesSnap = await getDocs(
        collection(db, 'courses', duplicateTarget.id, 'modules'),
      );

      let batch = writeBatch(db);
      let writes = 0;
      const commitBatch = async () => {
        await batch.commit();
        batch = writeBatch(db);
        writes = 0;
      };

      for (const moduleDoc of modulesSnap.docs) {
        const moduleData = moduleDoc.data();
        const targetRef = doc(collection(db, 'courses', newCourseRef.id, 'modules'));
        batch.set(targetRef, {
          ...moduleData,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        writes += 1;
        if (writes >= 450) await commitBatch();
      }
      if (writes > 0) await commitBatch();

      setDuplicateTarget(null);
    } catch (err) {
      console.error('Failed to duplicate course', err);
      setDuplicateError(err instanceof Error ? err.message : t.admin.courses.duplicateError);
    } finally {
      setDuplicating(false);
    }
  };

  if (!companyId) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        {t.admin.courses.selectCompanyFirst}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t.admin.courses.managerTitle}</h2>
            <p className="text-sm text-slate-500">{t.admin.courses.managerSubtitle}</p>
          </div>
          <button
            onClick={() => { setFormError(null); setCreateOpen(true); }}
            className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-slate-700 hover:shadow-lg active:scale-[0.97] active:shadow-none"
          >
            {t.admin.courses.newCourse}
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-500">
            {t.admin.courses.loading}
          </div>
        ) : (
          <div className="mt-4 -mx-2 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pl-2 pr-4">{t.admin.courses.titleCol}</th>
                  <th className="pb-2 px-4 whitespace-nowrap">{t.admin.courses.statusCol}</th>
                  <th className="pb-2 px-4 whitespace-nowrap">{t.admin.courses.lastUpdated}</th>
                  <th className="pb-2 pl-4 pr-2 text-center"></th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id} className="group text-sm">
                    <td className="py-3 pl-2 pr-4 border-b border-slate-100 rounded-l transition-colors group-has-[[data-title]:hover]:bg-slate-100">
                      <Link href={`/courses/${course.id}`} data-title className="group/title block">
                        <span className="font-semibold text-slate-700 transition-colors group-hover/title:text-slate-950">
                          {getLocaleValue(course.title) || t.admin.courses.untitled}
                        </span>
                        {getLocaleValue(course.description) && (
                          <p className="text-xs text-slate-500 group-hover/title:text-slate-600">
                            {getLocaleValue(course.description)}
                          </p>
                        )}
                      </Link>
                    </td>
                    <td className="py-3 px-4 border-b border-slate-100 transition-colors group-has-[[data-title]:hover]:bg-slate-100">
                      <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[course.status]}`}>
                        {course.status === 'active'
                          ? t.admin.courses.activeStatus
                          : t.admin.courses.inactiveStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 border-b border-slate-100 text-xs text-slate-500 whitespace-nowrap transition-colors group-has-[[data-title]:hover]:bg-slate-100">
                      {course.updatedAt?.toLocaleString('no-NO') ??
                        course.createdAt?.toLocaleString('no-NO') ??
                        'â€”'}
                    </td>
                    <td className="py-3 pl-4 pr-2 border-b border-slate-100 text-center rounded-r transition-colors group-has-[[data-title]:hover]:bg-slate-100">
                      <div className="flex justify-center gap-2">
                        <Link
                          href={`/courses/${course.id}/preview?lang=${locale}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center cursor-pointer rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold leading-normal font-sans text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                        >
                          {t.common.preview}
                        </Link>
                        <DuplicateButton
                          onClick={() => { setDuplicateError(null); setDuplicateTarget(course); }}
                          className="inline-flex appearance-none items-center cursor-pointer leading-normal font-sans"
                        />
                        <button
                          onClick={() => handleDeleteCourse(course)}
                          className="inline-flex appearance-none items-center cursor-pointer rounded-full border border-red-200 px-3 py-1 text-xs font-semibold leading-normal font-sans text-red-600 hover:border-red-300 hover:bg-red-50"
                        >
                          {t.admin.courses.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {courses.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                {t.admin.courses.noCourses}
              </div>
            )}
          </div>
        )}
      </div>

      {isCreateOpen && (
        <CreateCourseModal
          onClose={() => setCreateOpen(false)}
          onSubmit={handleCreateCourse}
          errorMessage={formError}
          t={t}
        />
      )}
      {duplicateTarget && (
        <DuplicateCourseModal
          course={duplicateTarget}
          onClose={() => setDuplicateTarget(null)}
          onSubmit={handleDuplicateCourse}
          errorMessage={duplicateError}
          loading={duplicating}
          buildTitle={buildDuplicateTitle}
          t={t}
        />
      )}
    </>
  );
}

type Translation = ReturnType<typeof getTranslation>;

const CourseModalFrame = ({
  tag,
  title,
  onClose,
  onSubmit,
  submitLabel,
  loading = false,
  children,
}: {
  tag: string;
  title: string;
  onClose: () => void;
  onSubmit: NonNullable<ComponentProps<'form'>['onSubmit']>;
  submitLabel: string;
  loading?: boolean;
  children: ReactNode;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{tag}</p>
            <h4 className="text-2xl font-semibold text-slate-900">{title}</h4>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer text-slate-400 transition hover:text-slate-700 disabled:opacity-60"
            aria-label={t.admin.courses.close}
            disabled={loading}
          >
            Ã—
          </button>
        </div>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {children}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              disabled={loading}
            >
              {t.admin.courses.cancel}
            </button>
            <button
              type="submit"
              className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
              disabled={loading}
            >
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const CreateCourseModal = ({
  onSubmit,
  onClose,
  errorMessage,
  t,
}: {
  onSubmit: (values: CourseFormValues) => Promise<void>;
  onClose: () => void;
  errorMessage: string | null;
  t: Translation;
}) => {
  const form = useForm<CourseFormValues>({
    defaultValues: {
      title: '',
      description: '',
      status: 'active',
      expirationType: 'none',
      expirationAmount: undefined,
      expirationDate: '',
    },
  });
  const expirationType = form.watch('expirationType');

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values);
    form.reset();
  });

  return (
    <CourseModalFrame
      tag={t.admin.courses.newCourseModal}
      title={t.admin.courses.courseInfo}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={t.admin.courses.saveAndManage}
    >
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        <span className="flex items-center justify-between">
          <span>{t.admin.courses.titleField}</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">NO</span>
        </span>
        <input
          {...form.register('title', { required: true })}
          className="rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        <span className="flex items-center justify-between">
          <span>{t.admin.courses.descriptionField}</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">NO</span>
        </span>
        <textarea
          {...form.register('description')}
          rows={3}
          className="rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        {t.admin.courses.statusField}
        <select
          {...form.register('status')}
          className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-sans text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        >
          <option value="active">{t.admin.courses.activeStatus}</option>
          <option value="inactive">{t.admin.courses.inactiveStatus}</option>
        </select>
      </label>
      <CourseExpirationFields form={form} expirationType={expirationType} />
      {errorMessage && (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {errorMessage}
        </p>
      )}
    </CourseModalFrame>
  );
};

const DuplicateCourseModal = ({
  course,
  onSubmit,
  onClose,
  errorMessage,
  loading,
  buildTitle,
  t,
}: {
  course: Course;
  onSubmit: (values: DuplicateCourseFormValues) => Promise<void>;
  onClose: () => void;
  errorMessage: string | null;
  loading: boolean;
  buildTitle: (course: Course | null) => string;
  t: Translation;
}) => {
  const form = useForm<DuplicateCourseFormValues>({ defaultValues: { title: '' } });

  useEffect(() => {
    form.reset({ title: buildTitle(course) });
  }, [course, form, buildTitle]);

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values);
    form.reset();
  });

  return (
    <CourseModalFrame
      tag={t.admin.courses.duplicateCourse}
      title={t.admin.courses.nameTheCopy}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={loading ? t.admin.courses.duplicating : t.admin.courses.duplicateCourse}
      loading={loading}
    >
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        <span className="flex items-center justify-between">
          <span>{t.admin.courses.titleField}</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">NO</span>
        </span>
        <input
          {...form.register('title', { required: true })}
          className="rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          disabled={loading}
        />
      </label>

      {errorMessage && (
        <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {errorMessage}
        </p>
      )}
    </CourseModalFrame>
  );
};
