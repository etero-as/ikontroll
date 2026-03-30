import type { ReactNode } from 'react';

import PreviewNavbar from '@/components/consumer/PreviewNavbar';

export default function PreviewLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <PreviewNavbar />
      {children}
    </div>
  );
}
