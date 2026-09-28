import type { ReactNode } from 'react';

import {
  Skeleton,
  SkeletonMetricCard,
  SkeletonTableRow,
  SkeletonText,
} from '@/components/Skeleton';

const CardShell = ({ children }: { children: ReactNode }) => (
  <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
);

export const SystemOwnerDashboardSkeleton = ({ label }: { label: string }) => (
  <div className="space-y-6" role="status" aria-busy="true" aria-label={label}>
    <span className="sr-only">{label}</span>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <SkeletonMetricCard key={index} />
      ))}
    </div>
    <CardShell>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="space-y-2">
          <SkeletonText width="9rem" className="h-2.5" />
          <Skeleton className="h-6 w-56 rounded-xl" />
        </div>
        <SkeletonText width="11rem" className="h-2.5" />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100">
          <thead>
            <tr>
              {Array.from({ length: 4 }).map((_, index) => (
                <th key={index} className="py-3 pr-4">
                  <SkeletonText width="4.5rem" className="h-2.5" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {Array.from({ length: 8 }).map((_, index) => (
              <SkeletonTableRow key={index} columns={4} />
            ))}
          </tbody>
        </table>
      </div>
    </CardShell>
  </div>
);

export const CustomerAdminDashboardSkeleton = ({ label }: { label: string }) => (
  <div className="space-y-6" role="status" aria-busy="true" aria-label={label}>
    <span className="sr-only">{label}</span>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <SkeletonMetricCard key={index} />
      ))}
    </div>
    <CardShell>
      <div className="space-y-2 border-b border-slate-100 pb-4">
        <SkeletonText width="5rem" className="h-2.5" />
        <Skeleton className="h-6 w-64 rounded-xl" />
      </div>
      <div className="mt-6 space-y-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <SkeletonText width="12rem" />
              </div>
              <SkeletonText width="7rem" className="h-2.5" />
            </div>
            <div className="mt-4 space-y-3">
              {Array.from({ length: 2 }).map((__, row) => (
                <div key={row} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <SkeletonText width="45%" />
                    <SkeletonText width="2.5rem" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </CardShell>
  </div>
);
