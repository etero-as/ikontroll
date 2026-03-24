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

const STATUS_LABELS: Record<CourseStatus, string> = {
  active: 'Aktiv',
  inactive: 'Inaktiv',
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

const buildDuplicateTitle = (course: Course | null) => {
  if (!course) return '';
  const baseTitle = getLocaleValue(course.title).trim();
  if (!baseTitle) {
    return 'Kopi av kurs';
  }
  return `Kopi av ${baseTitle}`;
};

export default function CourseManager() {
  const router = useRouter();
  const { companyId, profile } = useAuth();
  const { courses, loading, error, createCourse, deleteCourse } = useCourses(
    companyId ?? null,
  );
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicateTarget, setDuplicateTarget] = useState<Course | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  const resolveExpirationFields = (values: CourseFormValues) => {
    const expirationType = values.expirationType ?? 'none';
    const amount =
      typeof values.expirationAmount === 'number' && Number.isFinite(values.expirationAmount)
        ? Math.max(1, Math.round(values.expirationAmount))
        : null;
    const expirationDate = values.expirationDate?.trim() || null;

    if (expirationType === 'days') {
      return {
        expirationType,
        expirationDays: amount,
        expirationMonths: null,
        expirationDate: null,
      };
    }
    if (expirationType === 'months') {
      return {
        expirationType,
        expirationDays: null,
        expirationMonths: amount,
        expirationDate: null,
      };
    }
    if (expirationType === 'date') {
      return {
        expirationType,
        expirationDays: null,
        expirationMonths: null,
        expirationDate,
      };
    }
    return {
      expirationType: 'none' as const,
      expirationDays: null,
      expirationMonths: null,
      expirationDate: null,
    };
  };

  const handleCreateCourse = async (values: CourseFormValues) => {
    if (!companyId || !profile) {
      setFormError('Mangler selskapskontekst');
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
        ...expirationFields,
      };
      const id = await createCourse(payload);
      setCreateOpen(false);
      router.push(`/courses/${id}`);
    } catch (err) {
      console.error('Failed to create course', err);
      setFormError(
        err instanceof Error ? err.message : 'Kunne ikke opprette kurs.',
      );
    }
  };


  const handleDeleteCourse = async (course: Course) => {
    const confirmed = window.confirm(
      `Slett kurset "${getLocaleValue(course.title)}"? Dette kan ikke angres.`,
    );
    if (!confirmed) return;
    try {
      await deleteCourse(course.id);
    } catch (err) {
      console.error('Failed to delete course', err);
      alert('Kunne ikke slette kurs.');
    }
  };

  const handleDuplicateCourse = async (values: DuplicateCourseFormValues) => {
    if (!duplicateTarget) return;
    if (!companyId || !profile) {
      setDuplicateError('Mangler selskapskontekst');
      return;
    }
    try {
      const trimmedTitle = values.title.trim();
      if (!trimmedTitle) {
        setDuplicateError('Du må angi en tittel for kopien.');
        return;
      }
      setDuplicating(true);
      setDuplicateError(null);

      const sourceRef = doc(db, 'courses', duplicateTarget.id);
      const sourceSnap = await getDoc(sourceRef);
      if (!sourceSnap.exists()) {
        setDuplicateError('Fant ikke kurset du vil duplisere.');
        return;
      }
      const sourceData = sourceSnap.data();
      const nextTitle = {
        ...normalizeLocaleMap(sourceData.title),
        no: trimmedTitle,
      };

      const newCourseRef = await addDoc(collection(db, 'courses'), {
        ...sourceData,
        title: nextTitle,
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
        if (writes >= 450) {
          await commitBatch();
        }
      }

      if (writes > 0) {
        await commitBatch();
      }

      setDuplicateTarget(null);
    } catch (err) {
      console.error('Failed to duplicate course', err);
      setDuplicateError(
        err instanceof Error ? err.message : 'Kunne ikke duplisere kurset.',
      );
    } finally {
      setDuplicating(false);
    }
  };

  if (!companyId) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Velg et selskap i toppen før du kan administrere kurs.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Kurs</h2>
            <p className="text-sm text-slate-500">
              Opprett kurs og gå videre til detaljer for å bygge emner og spørsmål.
            </p>
          </div>
          <button
            onClick={() => {
              setFormError(null);
              setCreateOpen(true);
            }}
            className="inline-flex cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-slate-700 hover:shadow-lg active:scale-[0.97] active:shadow-none"
          >
            + Nytt kurs
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-slate-500">
            Laster kurs …
          </div>
        ) : (
          <div className="mt-4 -mx-2 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pl-2 pr-4">Tittel</th>
                  <th className="pb-2 px-4 whitespace-nowrap">Status</th>
                  <th className="pb-2 px-4 whitespace-nowrap">Sist oppdatert</th>
                  <th className="pb-2 pl-4 pr-2 text-center">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr
                    key={course.id}
                    className="group text-sm"
                  >
                    <td className="py-3 pl-2 pr-4 border-b border-slate-100 rounded-l transition-colors group-has-[[data-title]:hover]:bg-slate-100">
                      <Link
                        href={`/courses/${course.id}`}
                        data-title
                        className="group/title block"
                      >
                        <span className="font-semibold text-slate-700 transition-colors group-hover/title:text-slate-950">
                          {getLocaleValue(course.title) || 'Uten tittel'}
                        </span>
                        {getLocaleValue(course.description) && (
                          <p className="text-xs text-slate-500 group-hover/title:text-slate-600">
                            {getLocaleValue(course.description)}
                          </p>
                        )}
                      </Link>
                    </td>
                    <td className="py-3 px-4 border-b border-slate-100 transition-colors group-has-[[data-title]:hover]:bg-slate-100">
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${STATUS_STYLES[course.status]}`}
                      >
                        {STATUS_LABELS[course.status]}
                      </span>
                    </td>
                    <td className="py-3 px-4 border-b border-slate-100 text-xs text-slate-500 whitespace-nowrap transition-colors group-has-[[data-title]:hover]:bg-slate-100">
                      {course.updatedAt?.toLocaleString('no-NO') ??
                        course.createdAt?.toLocaleString('no-NO') ??
                        '—'}
                    </td>
                    <td className="py-3 pl-4 pr-2 border-b border-slate-100 text-center rounded-r transition-colors group-has-[[data-title]:hover]:bg-slate-100">
                      <div className="flex justify-center gap-2">
                        <Link
                          href={`/courses/${course.id}`}
                          className="inline-flex items-center cursor-pointer rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold leading-normal font-sans text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                        >
                          Administrer
                        </Link>
                        <DuplicateButton
                          onClick={() => {
                            setDuplicateError(null);
                            setDuplicateTarget(course);
                          }}
                          className="inline-flex appearance-none items-center cursor-pointer leading-normal font-sans"
                        />
                        <button
                          onClick={() => handleDeleteCourse(course)}
                          className="inline-flex appearance-none items-center cursor-pointer rounded-full border border-red-200 px-3 py-1 text-xs font-semibold leading-normal font-sans text-red-600 hover:border-red-300 hover:bg-red-50"
                        >
                          Slett
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {courses.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                Ingen kurs er opprettet ennå.
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
        />
      )}
      {duplicateTarget && (
        <DuplicateCourseModal
          course={duplicateTarget}
          onClose={() => setDuplicateTarget(null)}
          onSubmit={handleDuplicateCourse}
          errorMessage={duplicateError}
          loading={duplicating}
        />
      )}
    </>
  );
}

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
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              {tag}
            </p>
            <h4 className="text-2xl font-semibold text-slate-900">{title}</h4>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer text-slate-400 transition hover:text-slate-700 disabled:opacity-60"
            aria-label="Lukk"
            disabled={loading}
          >
            ×
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
              Avbryt
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
}: {
  onSubmit: (values: CourseFormValues) => Promise<void>;
  onClose: () => void;
  errorMessage: string | null;
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
      tag="Nytt kurs"
      title="Kursinformasjon"
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel="Lagre og administrer"
    >
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        <span className="flex items-center justify-between">
          <span>Tittel</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            NO
          </span>
        </span>
        <input
          {...form.register('title', { required: true })}
          className="rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        <span className="flex items-center justify-between">
          <span>Beskrivelse</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            NO
          </span>
        </span>
        <textarea
          {...form.register('description')}
          rows={3}
          className="rounded-xl border border-slate-200 px-3 py-2 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Status
        <select
          {...form.register('status')}
          className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-sans text-slate-700 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
        >
          <option value="active">Aktiv</option>
          <option value="inactive">Inaktiv</option>
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
}: {
  course: Course;
  onSubmit: (values: DuplicateCourseFormValues) => Promise<void>;
  onClose: () => void;
  errorMessage: string | null;
  loading: boolean;
}) => {
  const form = useForm<DuplicateCourseFormValues>({
    defaultValues: { title: '' },
  });

  useEffect(() => {
    form.reset({ title: buildDuplicateTitle(course) });
  }, [course, form]);

  const handleSubmit = form.handleSubmit(async (values) => {
    await onSubmit(values);
    form.reset();
  });

  return (
    <CourseModalFrame
      tag="Dupliser kurs"
      title="Gi kopien et navn"
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={loading ? 'Dupliserer …' : 'Dupliser kurs'}
      loading={loading}
    >
      <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        <span className="flex items-center justify-between">
          <span>Tittel</span>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            NO
          </span>
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
