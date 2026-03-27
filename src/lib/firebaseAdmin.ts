import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const ADMIN_APP_NAME = 'ikontroll-server-app';

const getOrInitAdminApp = () => {
  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  if (existing) return existing;
  try {
    return getApp(ADMIN_APP_NAME);
  } catch {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    const config = serviceAccountJson
      ? { credential: cert(JSON.parse(serviceAccountJson)) }
      : {};
    return initializeApp(config, ADMIN_APP_NAME);
  }
};

const adminApp = getOrInitAdminApp();

export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);

