'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  arrayRemove,
  arrayUnion,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { useCustomer } from '@/hooks/useCustomer';
import { useCourses } from '@/hooks/useCourses';
import { db } from '@/lib/firebase';
import { getTranslation } from '@/utils/translations';
import type { Customer } from '@/types/customer';

import CompanyUsersManager from './CompanyUsersManager';

export default function CustomerDetailsPage() {
  const params = useParams<{ customerId: string }>();
  const customerId = params?.customerId;
  const { companyId } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const td = t.admin.customerDetail;

  const { customer, loading, error } = useCustomer(
    companyId ?? null,
    customerId ?? null,
  );

  if (!companyId) {
    return (
      <section className="space-y-4">
        <Link
          href="/customers"
          className="text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          {td.backToCustomers}
        </Link>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          {td.selectCompanyFirst}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <Link
        href="/customers"
        className="inline-flex items-center text-sm font-semibold text-slate-600 hover:text-slate-900"
      >
        {td.backToCustomers}
      </Link>
      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          {td.loadingCustomer}
        </div>
      )}
      {!loading && error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-600">
          {error}
        </div>
      )}
      {!loading && customer && companyId && (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="space-y-1">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                {td.customerLabel}
              </p>
              <h1 className="text-3xl font-semibold text-slate-900">
                {customer.companyName}
              </h1>
              <p className="text-sm text-slate-500">
                {customer.address}, {customer.zipno} {customer.place}
              </p>
            </div>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Info label={td.orgNr}>{customer.vatNumber}</Info>
              <Info label={td.statusLabel}>
                {customer.status === 'active' ? td.statusActive : td.statusInactive}
              </Info>
              <Info label={td.subunitsLabel}>
                {customer.allowSubunits ? td.subunitsAllowed : td.subunitsDisallowed}
              </Info>
              <Info label={td.contactLabel}>
                <div className="space-y-1 text-sm text-slate-600">
                  <p className="font-medium">{customer.contactPerson}</p>
                  <p>{customer.contactEmail}</p>
                  <p>{customer.contactPhone}</p>
                </div>
              </Info>
            </dl>
          </div>

          <CourseAssignmentsCard companyId={companyId ?? customer.createdByCompanyId} customer={customer} />

          <CompanyUsersManager
            ownerCompanyId={customer.createdByCompanyId}
            customerId={customer.id}
            customerName={customer.companyName}
          />
        </>
      )}
    </section>
  );
}

const Info = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
      {label}
    </p>
    <div className="mt-2 text-sm text-slate-900">{children}</div>
  </div>
);

const CourseAssignmentsCard = ({
  companyId,
  customer,
}: {
  companyId: string;
  customer: Customer;
}) => {
  const { locale } = useLocale();
  const t = getTranslation(locale);
  const td = t.admin.customerDetail;

  const { courses, loading, error } = useCourses(companyId);
  const [updatingCourseId, setUpdatingCourseId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const assignedCourseIds = new Set(customer.courseIds ?? []);

  const toggleCourse = async (courseId: string, nextValue: boolean) => {
    try {
      setAssignError(null);
      setUpdatingCourseId(courseId);
      await updateDoc(doc(db, 'customers', customer.id), {
        courseIds: nextValue ? arrayUnion(courseId) : arrayRemove(courseId),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to update course access', err);
      setAssignError(
        err instanceof Error ? err.message : td.cannotUpdateCourseAccess,
      );
    } finally {
      setUpdatingCourseId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {td.coursesLabel}
        </p>
        <p className="text-base text-slate-600">{td.coursesSubtitle}</p>
      </div>

      {assignError && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600">
          {assignError}
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        {loading && <p className="text-sm text-slate-500">{td.loadingCourses}</p>}
        {!loading && error && (
          <p className="text-sm text-red-600">{error}</p>
        )}
        {!loading && !error && courses.length === 0 && (
          <p className="text-sm text-slate-500">{td.noCoursesAvailable}</p>
        )}
        {!loading && !error && courses.length > 0 && (
          <table className="min-w-full">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="pb-2">{td.coursesLabel}</th>
                <th className="pb-2">{t.common.status}</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => {
                const courseTitle =
                  typeof course.title === 'object'
                    ? course.title.no ?? course.title.en ?? t.common.untitled
                    : course.title ?? t.common.untitled;
                const isChecked = assignedCourseIds.has(course.id);
                const busy = updatingCourseId === course.id;
                return (
                  <tr
                    key={course.id}
                    className="border-b border-slate-100 hover:bg-slate-50"
                  >
                    <td className="py-3 text-sm font-semibold text-slate-900">
                      {courseTitle}
                    </td>
                    <td className="py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          course.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {course.status === 'active' ? td.statusActive : td.statusInactive}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={busy}
                        onChange={(event) =>
                          toggleCourse(course.id, event.target.checked)
                        }
                        className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

