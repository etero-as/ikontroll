'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useConsumerCourses } from '@/hooks/useConsumerCourses';
import { useCustomer } from '@/hooks/useCustomer';
import type { Course } from '@/types/course';
import type { CustomerMembership } from '@/types/companyUser';
import { getLocalizedValue } from '@/utils/localization';
import { getTranslation } from '@/utils/translations';
import { useLocale } from '@/context/LocaleContext';
import { useCourseModules } from '@/hooks/useCourseModules';
import { useCourseProgress } from '@/hooks/useCourseProgress';

export default function MyCoursesPage() {
  const { profile, activeCustomerId, setActiveCustomerId, firebaseUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale } = useLocale();
  const [courseCode, setCourseCode] = useState('');
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemMessage, setRedeemMessage] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const autoRedeemRef = useRef(false);
  const t = getTranslation(locale);

  const memberships = useMemo(
    () =>
      ((profile?.customerMemberships as CustomerMembership[] | undefined) ?? []).filter(
        (membership) =>
          Array.isArray(membership.roles) && membership.roles.includes('user'),
      ),
    [profile?.customerMemberships],
  );

  const selectedCustomerId = activeCustomerId ?? memberships[0]?.customerId ?? null;

  const selectedMembership =
    memberships.find((membership) => membership.customerId === selectedCustomerId) ??
    memberships[0];

  const { customer: selectedCustomer } = useCustomer(null, selectedMembership?.customerId ?? null);

  const assignedCourseIds = selectedMembership?.assignedCourseIds ?? [];
  const { courses, loading } = useConsumerCourses(assignedCourseIds);

  const handleSelectCustomer = (customerId: string) => {
    setActiveCustomerId(customerId);
  };

  const redeemCourseCode = useCallback(
    async (code: string, isAuto = false) => {
      const normalizedCode = code.trim().toUpperCase();
      if (!firebaseUser || !normalizedCode) {
        return;
      }
      setRedeeming(true);
      setRedeemError(null);
      setRedeemMessage(null);
      try {
        const idToken = await firebaseUser.getIdToken();
        const response = await fetch('/api/course-invite/redeem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: normalizedCode, idToken }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || t.courses.courseAddError);
        }
        const data = (await response.json().catch(() => ({}))) as {
          customerId?: string;
        };
        if (data.customerId && data.customerId !== activeCustomerId) {
          setActiveCustomerId(data.customerId);
        }
        setRedeemMessage(t.courses.courseAdded);
        if (!isAuto) {
          setCourseCode('');
        }
      } catch (err) {
        console.error('Failed to redeem course code', err);
        setRedeemError(
          err instanceof Error ? err.message : t.courses.courseAddError,
        );
      } finally {
        setRedeeming(false);
      }
    },
    [activeCustomerId, firebaseUser, setActiveCustomerId, t],
  );

  useEffect(() => {
    if (!firebaseUser || autoRedeemRef.current) {
      return;
    }
    const codeFromUrl = searchParams.get('code');
    const storedCode =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('pendingCourseInviteCode')
        : null;
    const code = codeFromUrl || storedCode;
    if (!code) {
      return;
    }
    autoRedeemRef.current = true;
    if (storedCode) {
      window.sessionStorage.removeItem('pendingCourseInviteCode');
    }
    setCourseCode(code);
    redeemCourseCode(code, true);
    if (codeFromUrl) {
      router.replace('/my-courses');
    }
  }, [firebaseUser, redeemCourseCode, router, searchParams]);

  if (!memberships.length) {
    return (
      <div className="space-y-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-slate-900">{t.courses.title}</h1>
          <p className="text-slate-500">{t.courses.subtitle}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          {t.courses.noAccess}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-slate-900">{t.courses.title}</h1>
        <p className="text-slate-500">{t.courses.subtitle}</p>
      </div>

      {memberships.length > 1 && (
        <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          {memberships.map((membership) => (
            <MembershipChip
              key={membership.customerId}
              membership={membership}
              isActive={membership.customerId === selectedMembership?.customerId}
              onSelect={handleSelectCustomer}
            />
          ))}
        </div>
      )}

      <section className="space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900">{t.courses.addCourseWithCode}</h2>
          <p className="text-sm text-slate-500">
            {t.courses.addCourseWithCodeSubtitle}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!courseCode.trim()) return;
              redeemCourseCode(courseCode.trim().toUpperCase());
            }}
            className="mt-4 flex flex-col gap-3 sm:flex-row"
          >
            <input
              type="text"
              value={courseCode}
              onChange={(event) => setCourseCode(event.target.value)}
              placeholder={t.courses.courseCodePlaceholder}
              className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
            <button
              type="submit"
              disabled={redeeming || !courseCode.trim()}
              className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {redeeming ? t.courses.addingCourse : t.courses.addCourse}
            </button>
          </form>
          {redeemMessage && <p className="mt-3 text-sm text-emerald-600">{redeemMessage}</p>}
          {redeemError && <p className="mt-3 text-sm text-red-600">{redeemError}</p>}
        </div>

        <h2 className="text-xl font-semibold text-slate-900">
        {t.courses.courseFrom}{' '}
          {selectedCustomer?.companyName ??
            selectedMembership?.customerName ??
            selectedMembership?.customerId ??
            ''}
        </h2>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-40 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : assignedCourseIds.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
            {t.courses.noCoursesAssigned}
          </div>
        ) : courses.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
            {t.courses.coursesLoadError}
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <ConsumerCourseCard key={course.id} course={course} locale={locale} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ConsumerCourseCard({ course, locale }: { course: Course; locale: string }) {
  const { completedModules } = useCourseProgress(course.id);
  const { modules } = useCourseModules(course.id);
  const t = getTranslation(locale);
  const [imageError, setImageError] = useState(false);

  const totalModules = modules.length;
  const completedCount = modules.filter((module) =>
    completedModules.includes(module.id),
  ).length;
  
  const progressPercent = totalModules
    ? Math.round((completedCount / totalModules) * 100)
    : 0;

  const isCompleted = totalModules > 0 && completedCount === totalModules;
  const isStarted = completedCount > 0;

  return (
    <Link
      href={`/my-courses/${course.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:border-slate-400 hover:shadow-lg"
    >
      <div className="relative h-48 bg-slate-100 overflow-hidden">
        {course.courseImageUrl && !imageError ? (
          <img
            src={course.courseImageUrl}
            alt={getLocalizedValue(course.title, locale)}
            className="h-full w-full object-cover transition group-hover:scale-105"
            onError={() => setImageError(true)}
          />
        ) : (
           <div className="flex h-full items-center justify-center text-slate-400">
             {t.courses.noImage}
           </div>
        )}
        {isCompleted && (
          <div className="absolute top-3 right-3 rounded-full bg-emerald-500 px-3 py-1 text-xs font-bold text-white shadow-sm">
            {t.courses.completed}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-lg font-semibold text-slate-900 line-clamp-2">
          {getLocalizedValue(course.title, locale)}
        </h3>
        <div className="mt-auto pt-4 space-y-2">
          <div className="flex justify-between text-xs font-medium text-slate-500">
            <span>{isStarted ? `${progressPercent}${t.courses.percentCompleted}` : t.courses.notStarted}</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full transition-all ${isCompleted ? 'bg-emerald-500' : 'bg-slate-900'}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>
    </Link>
  );
}

function MembershipChip({
  membership,
  isActive,
  onSelect,
}: {
  membership: CustomerMembership;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  const { customer } = useCustomer(null, membership.customerId);
  const displayName =
    customer?.companyName ?? membership.customerName ?? membership.customerId;
  return (
    <button
      onClick={() => onSelect(membership.customerId)}
      className={`rounded-full px-4 py-1 text-sm font-semibold transition ${
        isActive
          ? 'bg-slate-900 text-white'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {displayName}
    </button>
  );
}
