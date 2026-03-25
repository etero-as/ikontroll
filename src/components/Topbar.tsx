'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/context/AuthContext';
import { useCustomer } from '@/hooks/useCustomer';

type MenuPosition = { top: number; right: number };

export function Topbar() {
  const {
    profile,
    logout,
    isCustomerAdmin,
    isSystemOwner,
    hasConsumerAccess,
    portalMode,
    setPortalMode,
    customerMemberships,
    activeCustomerId,
  } = useAuth();
  const router = useRouter();
  const { customer: activeCustomer } = useCustomer(null, activeCustomerId ?? null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const initials = profile
    ? `${profile.firstName?.[0] ?? ''}${profile.lastName?.[0] ?? ''}`
        .trim()
        .toUpperCase() || '?'
    : '?';

  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      if (
        open &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        const menu = document.getElementById('user-menu');
        if (menu && menu.contains(event.target as Node)) {
          return;
        }
        setOpen(false);
        setPosition(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setPosition(null);
      }
    };

    document.addEventListener('mousedown', handleGlobalClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleGlobalClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      setPosition(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: rect.bottom + 8,
      right: window.innerWidth - rect.right,
    });
    setOpen(true);
  };

  const handleLogout = async () => {
    setOpen(false);
    setPosition(null);
    await logout();
  };

  const canSwitchView = hasConsumerAccess && (isCustomerAdmin || isSystemOwner);

  const handleSwitchMode = (mode: 'admin' | 'user') => {
    setPortalMode(mode);
    setOpen(false);
    setPosition(null);
    router.push(mode === 'admin' ? '/dashboard' : '/my-courses');
  };

  const menu =
    open && position && typeof document !== 'undefined'
      ? createPortal(
          <div
            id="user-menu"
            style={{ top: position.top, right: position.right }}
            className="fixed z-50 w-60 rounded-2xl border border-slate-200 bg-white shadow-2xl"
          >
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">
                {profile?.firstName} {profile?.lastName}
              </p>
              <p className="text-xs text-slate-500">{profile?.email}</p>
            </div>
            {isCustomerAdmin && activeCustomerId && (
              <Link
                href={`/customers/${activeCustomerId}`}
                onClick={() => { setOpen(false); setPosition(null); }}
                className="block w-full px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Min konto
              </Link>
            )}
            {canSwitchView && (
              <button
                onClick={() => handleSwitchMode(portalMode === 'admin' ? 'user' : 'admin')}
                className="w-full px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {portalMode === 'admin' ? 'Gå til kursvisning' : 'Gå til adminvisning'}
              </button>
            )}
            <button
              onClick={handleLogout}
              className="w-full px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Logg ut
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <header className="sticky top-0 z-40 flex min-h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
        <div className="flex items-center gap-4">
          <span className="text-lg font-semibold tracking-wide text-slate-900">
            IKontroll
          </span>
          {isCustomerAdmin && customerMemberships.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>|</span>
              <span className="font-semibold text-slate-900">
                {activeCustomer?.companyName ??
                  customerMemberships.find(
                    (m) => m.customerId === activeCustomerId,
                  )?.customerName ??
                  activeCustomerId ??
                  'Velg kunde'}
              </span>
            </div>
          )}
        </div>
        <button
          ref={buttonRef}
          onClick={toggleMenu}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white transition hover:bg-slate-800"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {initials}
        </button>
      </header>
      {menu}
    </>
  );
}
