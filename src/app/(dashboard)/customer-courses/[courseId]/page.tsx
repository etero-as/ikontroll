'use client';

import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { useLocale } from '@/context/LocaleContext';
import { useCompanyUsers } from '@/hooks/useCompanyUsers';
import { useCourse } from '@/hooks/useCourse';
import { useCourseModules } from '@/hooks/useCourseModules';
import { useCourseUsersProgress } from '@/hooks/useCourseUsersProgress';
import { useCustomer } from '@/hooks/useCustomer';
import type { CompanyUser, CompanyUserRole, CustomerMembership } from '@/types/companyUser';
import { getLocalizedValue } from '@/utils/localization';
import { getTranslation } from '@/utils/translations';

export default function CourseDelegationPage() {
  const params = useParams();
  const courseId = params.courseId as string;
  const router = useRouter();
  const { activeCustomerId, isCustomerAdmin, firebaseUser } = useAuth();
  const { locale } = useLocale();
  const t = getTranslation(locale);

  // 1. Fetch Course Details
  const { course, loading: courseLoading } = useCourse(courseId);
  // 2. Fetch Modules (to calculate progress percentage)
  const { modules, loading: modulesLoading } = useCourseModules(courseId);
  
  // 3. Fetch Customer (to verify ownership/context)
  const { customer } = useCustomer(null, activeCustomerId);
  
  // 4. Fetch Users
  const {
    users,
    loading: usersLoading,
    updateUser,
  } = useCompanyUsers(customer?.createdByCompanyId ?? null, activeCustomerId);

  // 5. Fetch Progress for these users
  const userIds = useMemo(
    () => users.map((u) => u.authUid ?? u.id).filter(Boolean),
    [users],
  );
  const { progressMap } = useCourseUsersProgress(courseId, userIds);

  // UI State for selection
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [isUpdating, setIsUpdating] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteMessage, setInviteMessage] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);

  // Derived data
  const totalModules = modules.length;

  // Filter logic
  const [searchTerm, setSearchTerm] = useState('');
  
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const name = `${user.firstName} ${user.lastName}`.toLowerCase();
      return name.includes(searchTerm.toLowerCase()) || user.email.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }, [users, searchTerm]);

const ensureUserRoleForAssignment = (
  roles: CompanyUserRole[] = [],
  assigning: boolean,
): CompanyUserRole[] => {
  if (!assigning) {
    return roles;
  }
  if (roles.includes('admin') && !roles.includes('user')) {
    return [...roles, 'user'];
  }
  return roles;
};

  const handleCreateInvite = async () => {
    if (!firebaseUser || !activeCustomerId) {
      return;
    }
    setCreatingInvite(true);
    setInviteError(null);
    setInviteMessage(null);
    try {
      const idToken = await firebaseUser.getIdToken();
      const response = await fetch('/api/course-invite/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId,
          customerId: activeCustomerId,
          idToken,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || t.admin.courseInvite.createError);
      }
      const data = (await response.json().catch(() => ({}))) as { code?: string };
      if (!data.code) {
        throw new Error(t.admin.courseInvite.noCode);
      }
      setInviteCode(data.code);
      if (typeof window !== 'undefined') {
        setInviteLink(`${window.location.origin}/course-signup?code=${data.code}`);
      }
      setInviteMessage(t.admin.courseInvite.codeCreated);
    } catch (err) {
      console.error('Failed to create invite code', err);
      setInviteError(err instanceof Error ? err.message : t.admin.courseInvite.createError);
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleCopy = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setInviteMessage(successMessage);
      setInviteError(null);
    } catch (err) {
      console.error('Failed to copy invite', err);
      setInviteError(t.admin.courseInvite.copyError);
    }
  };

  // Assignment toggling
  const handleToggleAccess = async (
    userId: string,
    currentAssigned: boolean,
    user: CompanyUser,
  ) => {
    if (isUpdating) return;
    setIsUpdating(true);
    
    try {
      // We need to get the current membership and update assignedCourseIds
      const membership = user.customerMemberships.find(
        (m: CustomerMembership) => m.customerId === activeCustomerId,
      );
      if (!membership) return;

      const currentCourses = membership.assignedCourseIds ?? [];
      const newCourses = currentAssigned 
        ? currentCourses.filter((id: string) => id !== courseId)
        : [...currentCourses, courseId];

      const assigning = !currentAssigned;
      const nextRoles = ensureUserRoleForAssignment(membership.roles ?? [], assigning);

      await updateUser(
        user.id,
        {
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          phone: user.phone,
          roles: nextRoles,
          status: user.status,
          assignedCourseIds: newCourses,
        },
        user.authUid,
        membership.customerName
      );
    } catch (err) {
      console.error('Failed to update assignment', err);
      alert(t.admin.courseInvite.updateAssignmentError);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSelectAll = () => {
    if (selectedUsers.size === filteredUsers.length) {
      setSelectedUsers(new Set());
    } else {
      setSelectedUsers(new Set(filteredUsers.map(u => u.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedUsers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedUsers(next);
  };

  const handleBulkAssign = async (assign: boolean) => {
    if (!selectedUsers.size || isUpdating) return;
    setIsUpdating(true);
    
    try {
      await Promise.all(
        Array.from(selectedUsers).map(async (userId) => {
          const user = users.find((u) => u.id === userId);
          if (!user) return;

          const membership = user.customerMemberships.find(
            (m: CustomerMembership) => m.customerId === activeCustomerId,
          );
          if (!membership) return;

          const currentCourses = membership.assignedCourseIds ?? [];
          const hasCourse = currentCourses.includes(courseId);

          if (assign && hasCourse) return;
          if (!assign && !hasCourse) return;

          const newCourses = assign
            ? [...currentCourses, courseId]
            : currentCourses.filter((id: string) => id !== courseId);

          const nextRoles = ensureUserRoleForAssignment(
            membership.roles ?? [],
            assign,
          );

          await updateUser(
            user.id,
            {
              firstName: user.firstName,
              lastName: user.lastName,
              email: user.email,
              phone: user.phone,
              roles: nextRoles,
              status: user.status,
              assignedCourseIds: newCourses,
            },
            user.authUid,
            membership.customerName,
          );
        }),
      );
      setSelectedUsers(new Set());
    } catch (err) {
      console.error('Bulk update failed', err);
      alert(t.admin.courseInvite.bulkUpdateError);
    } finally {
      setIsUpdating(false);
    }
  };

  if (!isCustomerAdmin || !activeCustomerId) {
    return null; // Or redirect handled in layout
  }

  if (courseLoading || modulesLoading || usersLoading) {
    return <div className="p-8 text-center text-slate-500">{t.common.loading}</div>;
  }

  if (!course) {
    return <div className="p-8 text-center text-red-500">{t.admin.courseDetail.courseNotFound}</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <button 
            onClick={() => router.back()} 
            className="mb-2 text-sm font-medium text-slate-500 hover:text-slate-900"
          >
            ← {t.common.back}
          </button>
          <h1 className="text-2xl font-bold text-slate-900">
            {getLocalizedValue(course.title, 'no')}
          </h1>
          <p className="text-slate-500">{t.admin.courseInvite.manageAccessSubtitle}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t.admin.courseInvite.signupWithCode}</h2>
            <p className="text-sm text-slate-500">
              {t.admin.courseInvite.shareCodeDescription}
            </p>
          </div>
          <button
            onClick={handleCreateInvite}
            disabled={creatingInvite}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {creatingInvite ? t.admin.courseInvite.creating : t.admin.courseInvite.createCode}
          </button>
        </div>

        {inviteCode && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-slate-700">{t.admin.courseInvite.courseCode}</div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-lg bg-white px-3 py-2 font-semibold text-slate-900">
                {inviteCode}
              </span>
              <button
                type="button"
                onClick={() => handleCopy(inviteCode, t.admin.courseInvite.codeCopied)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
              >
                {t.admin.courseInvite.copyCode}
              </button>
            </div>
            {inviteLink && (
              <div className="mt-3 text-sm text-slate-600">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {t.admin.courseInvite.registrationLink}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="break-all rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                    {inviteLink}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(inviteLink, t.admin.courseInvite.linkCopied)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800"
                  >
                    {t.admin.courseInvite.copyLink}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {inviteMessage && (
          <p className="mt-3 text-sm text-emerald-600">{inviteMessage}</p>
        )}
        {inviteError && <p className="mt-3 text-sm text-red-600">{inviteError}</p>}
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <input 
              type="text" 
              placeholder={t.admin.courseInvite.searchParticipant} 
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm focus:border-slate-400 focus:outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          {selectedUsers.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">{t.admin.courseInvite.selectedCount(selectedUsers.size)}</span>
              <button
                onClick={() => handleBulkAssign(true)}
                disabled={isUpdating}
                className="rounded-xl bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
              >
                {t.admin.courseInvite.grantAccess}
              </button>
              <button
                onClick={() => handleBulkAssign(false)}
                disabled={isUpdating}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50"
              >
                {t.admin.courseInvite.revokeAccess}
              </button>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="w-10 px-4 py-3">
                  <input 
                    type="checkbox" 
                    className="rounded border-slate-300"
                    checked={filteredUsers.length > 0 && selectedUsers.size === filteredUsers.length}
                    onChange={handleSelectAll}
                  />
                </th>
                <th className="px-4 py-3">{t.admin.courseInvite.participant}</th>
                <th className="px-4 py-3">{t.admin.courseInvite.access}</th>
                <th className="px-4 py-3">{t.admin.courseInvite.progress}</th>
                <th className="px-4 py-3 text-right">{t.admin.courseInvite.action}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.map(user => {
                const membership = user.customerMemberships.find(m => m.customerId === activeCustomerId);
                const isAssigned = membership?.assignedCourseIds?.includes(courseId) ?? false;
                const progressKey = user.authUid ?? user.id;
                const completedModules = progressMap[progressKey] ?? [];
                const completedCount = completedModules.length;
                // Calculate progress based on current total modules
                // Note: If user completed modules that are deleted, count might be off visually > 100%.
                // We cap at 100% visually.
                const progressPercent = totalModules > 0 
                  ? Math.min(100, Math.round((completedCount / totalModules) * 100)) 
                  : 0;

                return (
                  <tr key={user.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <input 
                        type="checkbox" 
                        className="rounded border-slate-300"
                        checked={selectedUsers.has(user.id)}
                        onChange={() => handleToggleSelect(user.id)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{user.firstName} {user.lastName}</div>
                      <div className="text-xs text-slate-500">{user.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {isAssigned ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                          {t.admin.courseInvite.assigned}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-50 px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-500/10">
                          {t.admin.courseInvite.notAssigned}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div 
                            className={`h-full rounded-full transition-all ${progressPercent === 100 ? 'bg-emerald-500' : 'bg-slate-900'}`} 
                            style={{ width: `${progressPercent}%` }} 
                          />
                        </div>
                        <span className="text-xs font-medium text-slate-600">{progressPercent}%</span>
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {t.admin.courseInvite.modulesProgress(completedCount, totalModules)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleToggleAccess(user.id, isAssigned, user)}
                        disabled={isUpdating}
                        className={`text-xs font-medium ${
                          isAssigned 
                            ? 'text-red-600 hover:text-red-700' 
                            : 'text-emerald-600 hover:text-emerald-700'
                        }`}
                      >
                        {isAssigned ? t.admin.courseInvite.revokeAccess : t.admin.courseInvite.grantAccess}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    {t.admin.courseInvite.noUsersFound}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
