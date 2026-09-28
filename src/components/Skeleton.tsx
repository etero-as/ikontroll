import type { CSSProperties } from 'react';

export const Skeleton = ({
  className = '',
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) => <div className={`skeleton rounded-lg ${className}`} style={style} aria-hidden="true" />;

export const SkeletonText = ({
  width,
  className = '',
}: {
  width: string;
  className?: string;
}) => <Skeleton className={`h-3 ${className}`} style={{ width }} />;

export const SkeletonHeader = () => (
  <header className="space-y-2">
    <SkeletonText width="8rem" className="h-2.5" />
    <Skeleton className="h-8 w-64 rounded-xl" />
    <SkeletonText width="20rem" />
  </header>
);

export const SkeletonMetricCard = () => (
  <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
    <SkeletonText width="60%" className="h-2.5" />
    <Skeleton className="mt-3 h-8 w-24 rounded-xl" />
    <SkeletonText width="45%" className="mt-2 h-2" />
  </div>
);

export const SkeletonTableRow = ({ columns }: { columns: number }) => (
  <tr>
    {Array.from({ length: columns }).map((_, index) => (
      <td key={index} className="py-3 pr-4">
        <SkeletonText width={index === 0 ? '70%' : '40%'} />
      </td>
    ))}
  </tr>
);
