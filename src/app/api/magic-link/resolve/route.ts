'use server';

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';

import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

const MAGIC_LINK_COLLECTION = adminDb.collection('magicLinks');

interface MagicLinkData {
  authUid?: string;
  courseId?: string | null;
  redirect?: string;
  expiresAt?: number;
  consumed?: boolean;
}

const normalizeRedirect = (value: string | undefined) => {
  if (!value) {
    return '/my-courses';
  }
  return value.startsWith('/') ? value : '/my-courses';
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim().toLowerCase();

  if (!code) {
    return NextResponse.json({ error: 'Mangler kode / Missing code' }, { status: 400 });
  }

  const docRef = MAGIC_LINK_COLLECTION.doc(code);
  const snapshot = await docRef.get();
  if (!snapshot.exists) {
    return NextResponse.json({ error: 'Lenken er ugyldig / Invalid link' }, { status: 404 });
  }

  const data = snapshot.data() as MagicLinkData;
  const now = Date.now();

  if (data.consumed) {
    return NextResponse.json(
      { error: 'Lenken er allerede brukt / Link already used' },
      { status: 410 },
    );
  }

  if (typeof data.expiresAt === 'number' && data.expiresAt < now) {
    await docRef.update({
      consumed: true,
      consumedAt: FieldValue.serverTimestamp(),
      consumedReason: 'expired',
    });
    return NextResponse.json({ error: 'Lenken er utløpt / Link expired' }, { status: 410 });
  }

  if (!data.authUid) {
    return NextResponse.json({ error: 'Ugyldig lenke / Invalid link' }, { status: 400 });
  }

  const redirect = normalizeRedirect(data.redirect);

  try {
    const customToken = await adminAuth.createCustomToken(data.authUid, {
      loginSource: 'sms',
      issuedAt: now,
      ...(data.courseId ? { courseId: data.courseId } : {}),
    });

    await docRef.update({
      consumed: true,
      consumedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ token: customToken, redirect });
  } catch (error) {
    console.error('Failed to resolve magic link', error);
    return NextResponse.json(
      { error: 'Kunne ikke logge inn / Could not sign in' },
      { status: 500 },
    );
  }
}

