'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEventHandler } from 'react';

type SaveChangesButtonProps = {
  type?: 'button' | 'submit' | 'reset';
  loading?: boolean;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  idleLabel?: string;
  loadingLabel?: string;
  minLoadingMs?: number;
  className?: string;
};

const DEFAULT_MIN_LOADING_MS = 900;

const BASE_CLASS_NAME =
  'inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-all duration-150 hover:bg-slate-800 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-70';

function normalizeMinLoadingMs(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_MIN_LOADING_MS;
  }

  return Math.max(0, value);
}

export default function SaveChangesButton({
  type = 'submit',
  loading = false,
  disabled = false,
  onClick,
  idleLabel = 'Lagre endringer',
  loadingLabel = 'Lagrer …',
  minLoadingMs = DEFAULT_MIN_LOADING_MS,
  className,
}: SaveChangesButtonProps) {
  const [displayLoading, setDisplayLoading] = useState(loading);
  const loadingStartRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safeMinLoadingMs = normalizeMinLoadingMs(minLoadingMs);
  const isBusy = loading || displayLoading;

  const clearTimer = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const startLoading = useCallback(() => {
    clearTimer();

    if (loadingStartRef.current == null) {
      loadingStartRef.current = Date.now();
    }

    setDisplayLoading(true);
  }, [clearTimer]);

  const handleClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (!isBusy) {
      startLoading();
    }

    onClick?.(event);
  };

  useEffect(() => {
    if (loading) {
      clearTimer();

      if (loadingStartRef.current == null) {
        loadingStartRef.current = Date.now();
      }

      if (!displayLoading) {
        timeoutRef.current = setTimeout(() => {
          timeoutRef.current = null;
          setDisplayLoading(true);
        }, 0);
      }

      return clearTimer;
    }

    if (!displayLoading) {
      loadingStartRef.current = null;
      return clearTimer;
    }

    const elapsed = loadingStartRef.current ? Date.now() - loadingStartRef.current : 0;
    const remaining = Math.max(0, safeMinLoadingMs - elapsed);

    clearTimer();

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setDisplayLoading(false);
      loadingStartRef.current = null;
    }, remaining);

    return clearTimer;
  }, [clearTimer, displayLoading, loading, safeMinLoadingMs]);

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={isBusy || disabled}
      aria-busy={isBusy}
      className={className ? `${BASE_CLASS_NAME} ${className}` : BASE_CLASS_NAME}
    >
      {isBusy ? loadingLabel : idleLabel}
    </button>
  );
}

