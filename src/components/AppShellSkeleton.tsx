import { Skeleton, SkeletonHeader, SkeletonMetricCard } from '@/components/Skeleton';

const SidebarSkeleton = () => (
  <aside className="w-64 border-r border-slate-200 bg-white">
    <nav className="space-y-1 p-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </nav>
  </aside>
);

export const AppShellSkeleton = ({ label }: { label: string }) => (
  <div
    className="flex h-screen flex-col overflow-hidden bg-slate-50"
    role="status"
    aria-busy="true"
    aria-label={label}
  >
    <span className="sr-only">{label}</span>
    <header
      aria-hidden="true"
      className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4"
    >
      <Skeleton className="h-8 w-32 rounded-xl" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-24 rounded-xl" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>
    </header>
    <div aria-hidden="true" className="flex min-h-0 flex-1">
      <SidebarSkeleton />
      <main className="flex-1 overflow-hidden bg-slate-50 p-6">
        <section className="space-y-6">
          <SkeletonHeader />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonMetricCard key={index} />
            ))}
          </div>
        </section>
      </main>
    </div>
  </div>
);
