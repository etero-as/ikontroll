
'use client';

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
      className={`rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 cursor-grab active:cursor-grabbing${className ? ` ${className}` : ''}`}
      aria-label="Endre rekkefølge"
      title="Endre rekkefølge"
    >
      ⇅
    </button>
  );
}

