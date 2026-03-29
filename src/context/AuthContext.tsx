'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { User } from 'firebase/auth';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';

import { auth, db } from '@/lib/firebase';
import type { CustomerMembership } from '@/types/companyUser';
import type { CompanyMembership, CompanyRole, PortalUser } from '@/types/user';

type AuthContextValue = {
  firebaseUser: User | null;
  profile: PortalUser | null;
  companyId: string | null;
  setCompanyId: (companyId: string | null) => void;
  customerMemberships: CustomerMembership[];
  activeCustomerId: string | null;
  setActiveCustomerId: (customerId: string | null) => void;
  isSystemOwner: boolean;
  isCustomerAdmin: boolean;
  hasConsumerAccess: boolean;
  portalMode: 'admin' | 'user';
  setPortalMode: (mode: 'admin' | 'user') => void;
  needsRoleChoice: boolean;
  loading: boolean;
  logout: () => Promise<void>;
};

type PortalMode = 'admin' | 'user';
const PORTAL_MODE_STORAGE_KEY = 'ikontroll.portalMode';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const COMPANY_STORAGE_KEY = 'ikontroll.companyId';
const CUSTOMER_STORAGE_KEY = 'ikontroll.customerId';

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<PortalUser | null>(null);
  const [companyId, setCompanyIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return localStorage.getItem(COMPANY_STORAGE_KEY);
  });
  const [customerMemberships, setCustomerMemberships] = useState<CustomerMembership[]>([]);
  const [activeCustomerId, setActiveCustomerIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }
    return localStorage.getItem(CUSTOMER_STORAGE_KEY);
  });
  const [loading, setLoading] = useState(true);
  const [portalModeState, setPortalModeState] = useState<PortalMode | null>(null);
  const [portalModeHydrated, setPortalModeHydrated] = useState(false);

  const updateCompany = useCallback((id: string | null) => {
    setCompanyIdState(id);

    if (typeof window === 'undefined') {
      return;
    }

    if (id) {
      localStorage.setItem(COMPANY_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(COMPANY_STORAGE_KEY);
    }
  }, []);

  const updateActiveCustomer = useCallback(
    (id: string | null, persist: boolean = true) => {
      setActiveCustomerIdState(id);

      if (!persist || typeof window === 'undefined') {
        return;
      }

      if (id) {
        localStorage.setItem(CUSTOMER_STORAGE_KEY, id);
      } else {
        localStorage.removeItem(CUSTOMER_STORAGE_KEY);
      }
    },
    [],
  );

  const persistPortalMode = useCallback((mode: PortalMode | null) => {
    setPortalModeState(mode);
    if (typeof window === 'undefined') {
      return;
    }
    if (mode) {
      window.sessionStorage.setItem(PORTAL_MODE_STORAGE_KEY, mode);
    } else {
      window.sessionStorage.removeItem(PORTAL_MODE_STORAGE_KEY);
    }
  }, []);

  const setPortalMode = useCallback(
    (mode: PortalMode) => {
      persistPortalMode(mode);
    },
    [persistPortalMode],
  );

  const portalModeStateRef = useRef(portalModeState);
  portalModeStateRef.current = portalModeState;

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const stored = window.sessionStorage.getItem(PORTAL_MODE_STORAGE_KEY);
    if (stored === 'admin' || stored === 'user') {
      setPortalModeState(stored as PortalMode);
    }
    setPortalModeHydrated(true);
  }, []);

  useEffect(() => {
    let profileUnsubscribe: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, (current) => {
      if (profileUnsubscribe) {
        profileUnsubscribe();
        profileUnsubscribe = null;
      }

      setFirebaseUser(current);
      setLoading(true);

      if (!current) {
        setProfile(null);
        updateCompany(null);
        updateActiveCustomer(null);
        setCustomerMemberships([]);
        persistPortalMode(null);
        setLoading(false);
        return;
      }

      const userDocRef = doc(db, 'users', current.uid);
      profileUnsubscribe = onSnapshot(
        userDocRef,
        (snapshot) => {
          if (!snapshot.exists()) {
            setProfile(null);
            console.warn('User document missing for uid', current.uid);
            setCustomerMemberships([]);
            updateActiveCustomer(null);
            setLoading(false);
            return;
          }

          const data = snapshot.data();
          const companyRaw = Array.isArray(data.companyIds) ? data.companyIds : [];

          const normalizedCompanies: CompanyMembership[] = companyRaw
            .map((entry) => {
              if (
                typeof entry === 'object' &&
                entry !== null &&
                'companyId' in entry
              ) {
                const { companyId, roles, displayName } = entry as {
                  companyId?: unknown;
                  roles?: unknown;
                  displayName?: unknown;
                };
                if (typeof companyId === 'string') {
                  const normalizedRoles = Array.isArray(roles)
                    ? roles.filter((role): role is CompanyRole =>
                        role === 'admin' || role === 'editor' || role === 'viewer',
                      )
                    : [];
                  return {
                    companyId,
                    roles: normalizedRoles,
                    displayName: typeof displayName === 'string' ? displayName : undefined,
                  };
                }
              } else if (typeof entry === 'string') {
                return { companyId: entry, roles: [] as CompanyRole[] };
              }
              return null;
            })
            .filter((entry): entry is CompanyMembership => entry !== null);

          const portalUser: PortalUser = {
            id: snapshot.id,
            email: typeof data.email === 'string' ? data.email : '',
            firstName: typeof data.firstName === 'string' ? data.firstName : '',
            lastName: typeof data.lastName === 'string' ? data.lastName : '',
            companyIds: normalizedCompanies,
            customerMemberships: Array.isArray(data.customerMemberships)
              ? (data.customerMemberships as CustomerMembership[])
              : [],
          };
          setProfile(portalUser);

          const adminCompanies =
            portalUser.companyIds?.filter((company) =>
              company.roles?.includes('admin'),
            ) ?? [];

          if (adminCompanies.length === 1) {
            updateCompany(adminCompanies[0].companyId);
          } else if (
            adminCompanies.every(
              (company) => company.companyId !== companyId,
            )
          ) {
            updateCompany(null);
          }

          const allCustomerMemberships = portalUser.customerMemberships ?? [];
          const adminMemberships = allCustomerMemberships.filter((membership) =>
            membership.roles.includes('admin'),
          );
          const consumerMemberships = allCustomerMemberships.filter((membership) =>
            membership.roles.includes('user'),
          );
          setCustomerMemberships(adminMemberships);

          const selectionPreference = portalModeStateRef.current ?? null;
          const selectionPool =
            selectionPreference === 'user' && consumerMemberships.length
              ? consumerMemberships
              : adminMemberships.length
              ? adminMemberships
              : consumerMemberships.length
              ? consumerMemberships
              : allCustomerMemberships;

          if (selectionPool.length === 1) {
            updateActiveCustomer(selectionPool[0].customerId);
          } else if (!selectionPool.length) {
            updateActiveCustomer(null);
          } else {
            const belongsToAnyMembership = allCustomerMemberships.some(
              (membership) => membership.customerId === activeCustomerId,
            );
            if (!belongsToAnyMembership) {
              const stored = localStorage.getItem(CUSTOMER_STORAGE_KEY);
              const validStored = selectionPool.find(
                (membership) => membership.customerId === stored,
              );
              if (validStored) {
                setActiveCustomerIdState(validStored.customerId);
              } else {
                updateActiveCustomer(null, false);
              }
            }
          }

          setLoading(false);
        },
        (error) => {
          console.error('Failed to load user profile', error);
          setProfile(null);
          setCustomerMemberships([]);
          updateActiveCustomer(null);
          setLoading(false);
        },
      );
    });

    return () => {
      if (profileUnsubscribe) {
        profileUnsubscribe();
      }
      unsubscribe();
    };
  }, [activeCustomerId, companyId, persistPortalMode, updateActiveCustomer, updateCompany]);

  const isSystemOwner =
    (profile?.companyIds ?? []).some((company) => company.roles?.includes('admin'));
  const isCustomerAdmin = customerMemberships.length > 0;
  const hasAdminAccess = isSystemOwner || isCustomerAdmin;
  const hasConsumerAccess =
    (profile?.customerMemberships ?? []).some((membership) =>
      Array.isArray(membership.roles)
        ? membership.roles.includes('user')
        : false,
    );
  const needsRoleChoice =
    portalModeHydrated && !loading && hasAdminAccess && hasConsumerAccess && !portalModeState;

  useEffect(() => {
    if (loading || !portalModeHydrated) {
      return;
    }
    if (!hasAdminAccess && !hasConsumerAccess) {
      persistPortalMode(null);
      return;
    }
    if (!hasAdminAccess && portalModeState === 'admin') {
      persistPortalMode(hasConsumerAccess ? 'user' : null);
    } else if (!hasConsumerAccess && portalModeState === 'user') {
      persistPortalMode(hasAdminAccess ? 'admin' : null);
    }
  }, [
    hasAdminAccess,
    hasConsumerAccess,
    portalModeState,
    persistPortalMode,
    loading,
    portalModeHydrated,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const firstReady = Boolean(profile?.firstName?.trim());
    const lastReady = Boolean(profile?.lastName?.trim());
    if (firstReady && lastReady) {
      window.sessionStorage.removeItem('profileCompletionBypass');
      const bypassKey = firebaseUser?.uid
        ? `profileCompletionBypass_${firebaseUser.uid}`
        : null;
      if (bypassKey) {
        window.sessionStorage.removeItem(bypassKey);
      }
    }
  }, [firebaseUser?.uid, profile?.firstName, profile?.lastName]);

  let portalMode: PortalMode =
    portalModeState ?? (hasAdminAccess ? 'admin' : 'user');

  if (portalMode === 'admin' && !hasAdminAccess && hasConsumerAccess) {
    portalMode = 'user';
  }
  if (portalMode === 'user' && !hasConsumerAccess && hasAdminAccess) {
    portalMode = 'admin';
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      firebaseUser,
      profile,
      companyId,
      setCompanyId: updateCompany,
      customerMemberships,
      activeCustomerId,
      setActiveCustomerId: updateActiveCustomer,
      isSystemOwner,
      isCustomerAdmin,
      hasConsumerAccess,
      portalMode,
      setPortalMode,
      needsRoleChoice,
      loading,
      logout: () => signOut(auth),
    }),
    [
      firebaseUser,
      profile,
      companyId,
      customerMemberships,
      activeCustomerId,
      isSystemOwner,
      isCustomerAdmin,
      hasConsumerAccess,
      portalMode,
      setPortalMode,
      needsRoleChoice,
      loading,
      updateCompany,
      updateActiveCustomer,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

