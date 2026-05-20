'use server';

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';

import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

const usersCollection = adminDb.collection('users');
const SVEVE_USERNAME = process.env.SVEVE_USERNAME;
const SVEVE_PASSWORD = process.env.SVEVE_PASSWORD;
const SVEVE_SENDER = process.env.SVEVE_SENDER ?? 'Skillo';
const PORTAL_LOGIN_URL =
  process.env.PORTAL_LOGIN_URL ??
  process.env.NEXT_PUBLIC_PORTAL_URL ??
  'https://portal.ikontroll.no/login';

type CompanyUserRole = 'admin' | 'user';

interface UserPayloadBody {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  roles: CompanyUserRole[];
  status: 'active' | 'inactive';
  assignedCourseIds?: string[];
}

interface CompanyUserPayload {
  companyId: string;
  customerId: string;
  customerName?: string;
  userId?: string;
  authUid?: string;
  user?: UserPayloadBody;
  password?: string;
}

const validateBasePayload = (
  body: Partial<CompanyUserPayload> | null,
  requireCompanyId: boolean = true,
) => {
  const errors: string[] = [];
  if (requireCompanyId && !body?.companyId) errors.push('companyId');
  if (!body?.customerId) errors.push('customerId');
  return errors;
};

const normalizeMemberships = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [] as {
      customerId: string;
      customerName?: string;
      roles: CompanyUserRole[];
      assignedCourseIds: string[];
    }[];
  }
  return value
    .map((entry) => {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        'customerId' in entry &&
        'roles' in entry
      ) {
        const { customerId, roles, assignedCourseIds, customerName } = entry as {
          customerId?: unknown;
          roles?: unknown;
          assignedCourseIds?: unknown;
          customerName?: unknown;
        };
        if (typeof customerId === 'string') {
          const validRoles = Array.isArray(roles)
            ? roles.filter(
                (role): role is CompanyUserRole =>
                  role === 'admin' || role === 'user',
              )
            : [];
          
          const validAssignedCourseIds = Array.isArray(assignedCourseIds)
            ? assignedCourseIds.filter((id): id is string => typeof id === 'string')
            : [];

          const nextEntry: {
            customerId: string;
            customerName?: string;
            roles: CompanyUserRole[];
            assignedCourseIds: string[];
          } = {
            customerId,
            roles: validRoles,
            assignedCourseIds: validAssignedCourseIds,
          };
          if (typeof customerName === 'string' && customerName.trim()) {
            nextEntry.customerName = customerName;
          }
          return nextEntry;
        }
      }
      return null;
    })
    .filter(
      (
        membership,
      ): membership is {
        customerId: string;
        customerName?: string;
        roles: CompanyUserRole[];
        assignedCourseIds: string[];
      } => membership !== null,
    );
};

const upsertMembership = (
  memberships: {
    customerId: string;
    customerName?: string;
    roles: CompanyUserRole[];
    assignedCourseIds?: string[];
  }[],
  customerId: string,
  customerName: string | undefined,
  roles: CompanyUserRole[] | undefined,
  assignedCourseIds?: string[],
) => {
  const existingMembership = memberships.find(
    (membership) => membership.customerId === customerId,
  );
  const requestedRoles = Array.isArray(roles) ? roles : [];
  const roleSeed = requestedRoles.length ? requestedRoles : (existingMembership?.roles ?? []);
  const nextRoles = Array.from(new Set(roleSeed));
  const nextAssignedCourseIds = Array.isArray(assignedCourseIds)
    ? assignedCourseIds.filter((id): id is string => typeof id === 'string')
    : (existingMembership?.assignedCourseIds ?? []);
  if (nextAssignedCourseIds.length && !nextRoles.includes('user')) {
    nextRoles.push('user');
  }
  const filteredMemberships = memberships.filter(
    (membership) => membership.customerId !== customerId,
  );

  const membershipEntry: {
    customerId: string;
    customerName?: string;
    roles: CompanyUserRole[];
    assignedCourseIds: string[];
  } = {
    customerId,
    roles: nextRoles,
    assignedCourseIds: nextAssignedCourseIds,
  };
  if (typeof customerName === 'string' && customerName.trim()) {
    membershipEntry.customerName = customerName;
  } else if (existingMembership?.customerName) {
    membershipEntry.customerName = existingMembership.customerName;
  }
  filteredMemberships.push(membershipEntry);

  return filteredMemberships;
};

const upsertUserDocument = async ({
  authUid,
  user,
  companyId,
  customerId,
  customerName,
  preserveProfile = false,
}: {
  authUid: string;
  user: UserPayloadBody;
  companyId: string;
  customerId: string;
  customerName?: string;
  preserveProfile?: boolean;
}) => {
  const userDocRef = usersCollection.doc(authUid);
  const snapshot = await userDocRef.get();
  const existingData = snapshot.exists ? snapshot.data() : null;
  const memberships = normalizeMemberships(existingData?.customerMemberships);
  const previousMembership = memberships.find((entry) => entry.customerId === customerId);
  const previousAssignedCourses = previousMembership?.assignedCourseIds ?? [];
  const normalizedAssignedCourses = Array.isArray(user.assignedCourseIds)
    ? user.assignedCourseIds.filter((id): id is string => typeof id === 'string')
    : [];
  const nextMemberships = upsertMembership(
    memberships,
    customerId,
    customerName,
    user.roles,
    normalizedAssignedCourses,
  );

  const sanitizedMemberships = nextMemberships.map(
    ({ customerName: memName, ...rest }) =>
      typeof memName === 'string' && memName.trim()
        ? { ...rest, customerName: memName }
        : rest,
  );

  const resolvedFirstName =
    preserveProfile && typeof existingData?.firstName === 'string'
      ? (existingData.firstName as string)
      : user.firstName;
  const resolvedLastName =
    preserveProfile && typeof existingData?.lastName === 'string'
      ? (existingData.lastName as string)
      : user.lastName;
  const resolvedEmail =
    preserveProfile && typeof existingData?.email === 'string'
      ? (existingData.email as string)
      : user.email;
  const resolvedPhone =
    preserveProfile && typeof existingData?.phone === 'string'
      ? (existingData.phone as string)
      : user.phone;
  const resolvedStatus =
    preserveProfile && typeof existingData?.status === 'string'
      ? (existingData.status as string)
      : user.status;

  const updatePayload: Record<string, unknown> = {
    firstName: resolvedFirstName,
    lastName: resolvedLastName,
    email: resolvedEmail,
    phone: resolvedPhone,
    status: resolvedStatus,
    authUid,
    customerIdRefs: FieldValue.arrayUnion(customerId),
    customerMemberships: sanitizedMemberships,
    createdAt: existingData?.createdAt ?? FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (companyId) {
    updatePayload.companyIds = FieldValue.arrayUnion(companyId);
  }

  await userDocRef.set(updatePayload, { merge: true });

  const addedCourseIds = normalizedAssignedCourses.filter(
    (courseId) => !previousAssignedCourses.includes(courseId),
  );

  return { addedCourseIds };
};


export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CompanyUserPayload | null;
  const logBody =
    body && typeof body.password === 'string' && body.password.trim()
      ? { ...body, password: '[redacted]' }
      : body;
  console.log('POST /api/company-users payload', logBody);
  const missing = validateBasePayload(body);
  if (!body?.user) missing.push('user');

  if (missing.length) {
    return NextResponse.json(
      { error: `Mangler felt: ${missing.join(', ')}` },
      { status: 400 },
    );
  }

  if (!body) {
    return NextResponse.json({ error: 'Mangler payload' }, { status: 400 });
  }

  const { companyId, customerId, customerName } = body;
  const user = body.user!;
  const requestedPassword = typeof body.password === 'string' ? body.password.trim() : '';

  try {
    let authUser = null;
    let authUserExisted = false;
    try {
      authUser = await adminAuth.getUserByEmail(user.email);
      authUserExisted = true;
    } catch {
      authUser = null;
    }

    if (!authUser) {
      const initialPassword = requestedPassword || generateTemporaryPassword();
      authUser = await adminAuth.createUser({
        email: user.email,
        password: initialPassword,
        displayName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
        disabled: user.status === 'inactive',
      });
    } else if (user.status === 'inactive' || user.status === 'active') {
      const updatePayload: { disabled: boolean; password?: string } = {
        disabled: user.status === 'inactive',
      };
      if (requestedPassword) {
        updatePayload.password = requestedPassword;
      }
      await adminAuth.updateUser(authUser.uid, updatePayload);
    }

    const { addedCourseIds } = await upsertUserDocument({
      authUid: authUser.uid,
      user,
      companyId,
      customerId,
      customerName,
      preserveProfile: authUserExisted,
    });

    console.log('POST /api/company-users addedCourseIds', {
      email: user.email,
      addedCourseIds,
    });

    const shouldResetPassword = !user.roles?.includes('admin');
    await notifyCourseAssignments(user.phone, addedCourseIds, authUser.uid, user.email, {
      resetPassword: shouldResetPassword,
    });


    return NextResponse.json({
      id: authUser.uid,
    });
  } catch (error: unknown) {
    console.error('Failed to create company user', error);
    return NextResponse.json(
      { error: (error as Error)?.message ?? 'Kunne ikke opprette bruker' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CompanyUserPayload | null;
  console.log('PATCH /api/company-users payload', body);
  const missing = validateBasePayload(body, false);
  if (!body?.userId) missing.push('userId');
  if (!body?.user) missing.push('user');

  if (missing.length) {
    return NextResponse.json(
      { error: `Mangler felt: ${missing.join(', ')}` },
      { status: 400 },
    );
  }

  if (!body) {
    return NextResponse.json({ error: 'Mangler payload' }, { status: 400 });
  }

  const { companyId, customerId, customerName, authUid } = body;
  const userId = body.userId!;
  const user = body.user!;
  const authTarget = authUid ?? userId;

  try {
    const { addedCourseIds } = await upsertUserDocument({
      authUid: userId,
      user,
      companyId,
      customerId,
      customerName,
    });

    await adminAuth.updateUser(authTarget, {
      email: user.email,
      displayName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
      disabled: user.status === 'inactive',
    });

    console.log('PATCH /api/company-users addedCourseIds', {
      email: user.email,
      addedCourseIds,
    });

    const shouldResetPassword = !user.roles?.includes('admin');
    await notifyCourseAssignments(user.phone, addedCourseIds, authTarget, user.email, {
      resetPassword: shouldResetPassword,
    });

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error('Failed to update company user', error);
    return NextResponse.json(
      { error: (error as Error)?.message ?? 'Kunne ikke oppdatere bruker' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as CompanyUserPayload | null;
  console.log('DELETE /api/company-users payload', body);
  const missing = validateBasePayload(body);
  if (!body?.userId) missing.push('userId');

  if (missing.length) {
    return NextResponse.json(
      { error: `Mangler felt: ${missing.join(', ')}` },
      { status: 400 },
    );
  }

  if (!body) {
    return NextResponse.json({ error: 'Mangler payload' }, { status: 400 });
  }

  const { customerId, authUid } = body;
  const userId = body.userId!;
  const authTarget = authUid ?? userId;

  try {
    if (!customerId) {
      return NextResponse.json(
        { error: 'customerId mangler' },
        { status: 400 },
      );
    }

    const userDocRef = usersCollection.doc(userId);
    const snapshot = await userDocRef.get();
    if (!snapshot.exists) {
      await adminAuth.deleteUser(authTarget);
      return NextResponse.json({ ok: true });
    }

    const memberships = normalizeMemberships(snapshot.data()?.customerMemberships);
    const remainingMemberships = memberships.filter(
      (membership) => membership.customerId !== customerId,
    );

    if (!remainingMemberships.length) {
      await userDocRef.delete();
      await adminAuth.deleteUser(authTarget);
    } else {
      await userDocRef.set(
        {
          customerMemberships: remainingMemberships,
          customerIdRefs: FieldValue.arrayRemove(customerId),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error('Failed to delete company user', error);
    return NextResponse.json(
      { error: (error as Error)?.message ?? 'Kunne ikke slette bruker' },
      { status: 500 },
    );
  }
}

const SVEVE_ENDPOINT = 'https://sveve.no/SMS/SendMessage';
const SVEVE_TEST_MODE = process.env.SVEVE_TEST === 'true';

const formatPhoneNumber = (raw: string | undefined | null) => {
  if (typeof raw !== 'string') {
    return '';
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  let normalized = trimmed.replace(/[^\d+]/g, '');
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  }
  if (!normalized.startsWith('+')) {
    normalized = `+${normalized}`;
  }
  return normalized;
};

const generateTemporaryPassword = (length: number = 6) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

const buildLoginUrlWithEmail = (email: string) => {
  try {
    const loginUrl = new URL(PORTAL_LOGIN_URL);
    if (email && email.trim()) {
      loginUrl.searchParams.set('email', email.trim());
    }
    return loginUrl.toString();
  } catch {
    return PORTAL_LOGIN_URL;
  }
};

const sendCredentialsSms = async ({
  phone,
  email,
  password,
  courseTitles,
}: {
  phone: string | undefined;
  email: string;
  password: string;
  courseTitles: string[];
}) => {
  const recipient = formatPhoneNumber(phone);
  if (!recipient) {
    return;
  }
  const loginUrl = buildLoginUrlWithEmail(email);
  const uniqueTitles = Array.from(new Set(courseTitles));
  const courseText = uniqueTitles.length
    ? uniqueTitles.length === 1
      ? `Du har fått tilgang til kurset ${uniqueTitles[0]}.`
      : `Du har fått tilgang til kursene ${uniqueTitles.join(', ')}.`
    : 'Du har fått tilgang til Skillo.';
  const message = `${courseText} Brukernavn: ${email}. Passord: ${password}. Logg inn: ${loginUrl}`;
  await sendSveveSms(recipient, message);
};


const resolveCourseTitle = (data: Record<string, unknown> | undefined) => {
  if (!data) return 'Nytt kurs';
  const title = data.title as unknown;
  if (typeof title === 'string' && title.trim()) {
    return title;
  }
  if (typeof title === 'object' && title !== null) {
    const map = title as Record<string, unknown>;
    return (
      (typeof map.no === 'string' && map.no.trim()) ||
      (typeof map.en === 'string' && map.en.trim()) ||
      'Nytt kurs'
    );
  }
  return 'Nytt kurs';
};

const fetchCourseTitles = async (courseIds: string[]) => {
  const entries = await Promise.all(
    courseIds.map(async (courseId) => {
      try {
        const snapshot = await adminDb.collection('courses').doc(courseId).get();
        if (!snapshot.exists) {
          return [courseId, 'Nytt kurs'] as const;
        }
        return [courseId, resolveCourseTitle(snapshot.data() ?? undefined)] as const;
      } catch (error) {
        console.error('Failed to load course title', courseId, error);
        return [courseId, 'Nytt kurs'] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
};

const sendSveveSms = async (to: string, text: string) => {
  if (!SVEVE_USERNAME || !SVEVE_PASSWORD) {
    console.warn('Sveve credentials missing, skipping SMS.');
    return;
  }
  const clean = formatPhoneNumber(to);
  if (!clean) {
    console.warn('Invalid recipient phone number, skipping SMS.');
    return;
  }
  const query = new URLSearchParams({
    user: SVEVE_USERNAME,
    passwd: SVEVE_PASSWORD,
    to: clean,
    msg: text,
    from: SVEVE_SENDER,
    f: 'json',
    test: SVEVE_TEST_MODE ? 'true' : 'false',
  });
  try {
    console.log('Sending Sveve SMS', { to: clean });
    const response = await fetch(`${SVEVE_ENDPOINT}?${query.toString()}`, {
      method: 'GET',
    });
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Sveve SMS request failed', response.status, errorText);
      return;
    }
    const json = (await response.json().catch(() => null)) as
      | { response?: { msgOkCount?: number; errors?: unknown } }
      | null;
    if (json?.response?.errors) {
      console.error('Sveve SMS response reported errors', json.response.errors);
    }
  } catch (error) {
    console.error('Sveve SMS request error', error);
  }
};

const notifyCourseAssignments = async (
  phone: string | undefined,
  courseIds: string[],
  authUid: string | undefined,
  email: string,
  options?: { resetPassword?: boolean },
) => {
  const hasAuthUid = Boolean(authUid);
  if (!courseIds.length || !authUid) {
    console.log('notifyCourseAssignments skipped', {
      courseIdsLength: courseIds.length,
      hasAuthUid,
    });
    return;
  }

  const shouldResetPassword = options?.resetPassword ?? true;
  if (!shouldResetPassword) {
    console.log('notifyCourseAssignments skipped password reset', {
      email,
      courseIdsLength: courseIds.length,
    });
    return;
  }
  console.log('notifyCourseAssignments sending SMS', {
    courseIds,
    email,
    hasPhone: Boolean(phone),
  });
  const titlesMap = await fetchCourseTitles(courseIds);
  const courseTitles = courseIds.map((courseId) => titlesMap[courseId] ?? 'Nytt kurs');
  const password = generateTemporaryPassword();
  await adminAuth.updateUser(authUid, { password });
  await sendCredentialsSms({ phone, email, password, courseTitles });
};
