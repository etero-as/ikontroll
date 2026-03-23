'use client';

import { GripVertical } from 'lucide-react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';

export default function DragHandle({
  attributes,
  listeners,
  className,
}: {
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  className?: string;
}) {
  return (
    <button
      type="button"
      {...attributes}
      {...(listeners ?? {})}
      className={`inline-flex items-center justify-center rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-600 cursor-grab active:cursor-grabbing${className ? ` ${className}` : ''}`}
      aria-label="Endre rekkefølge"
      title="Endre rekkefølge"
    >
      <GripVertical className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

export function DragHandleIcon({ className }: { className?: string }) {
  return <GripVertical className={className ?? 'h-4 w-4'} aria-hidden="true" />;
}

