# Deployment & Auto-Deploy Architecture

## Overview
The project uses GitHub Actions to automatically deploy to Firebase Hosting and Cloud Run when commits are pushed to `main`.

## Deployment Flow

### 1. GitHub Actions Trigger
- **Trigger**: Push to `main` branch
- **Workflow File**: `.github/workflows/deploy-production.yml`
- **Environment**: Ubuntu Linux (GitHub-hosted runner)

### 2. Build Stage
1. Node.js environment is set up
2. `npm install` installs dependencies from `package-lock.json`
3. `npm run build` compiles Next.js project
4. Output is written to `.next` and `.firebase/` directories

### 3. Firebase Deployment
1. **Authentication**: Uses `FIREBASE_TOKEN` secret (stored in GitHub repo settings)
2. **Project**: `internkontroll-8e12a` (defined in `firebase.json`)
3. **Hosting**: Static files deployed to Firebase Hosting (CDN)
4. **Functions**: Cloud Run container deployed with server-side routes (API + SSR)

### 4. Cloud Run Runtime
- Next.js framework adapter generates a Cloud Function
- Firebase Frameworks (preview) wraps Next.js for Cloud Run
- **Important**: Only supports Next.js 12–15.0 officially
- Uses Application Default Credentials (ADC) for Firestore/Auth access

## Version Constraints & Why

### Critical: Next.js 15.5.14 (not 16+)
- **Reason**: Firebase Frameworks preview does not support Next.js 16+
- **Issue**: Next.js 16 introduces breaking changes in config format and runtime behavior
- **Risk**: Next.js 16 deployments fail silently (500 errors in prod)
- **Status**: Firebase team is working on 16 support; upgrade when officially announced

### Critical: eslint 9.39.4 & eslint-config-next 15.5.14
- **Reason**: Must match Next.js version
- **Issue**: eslint 10+ requires different flat config format
- **Config**: `eslint.config.mjs` uses `FlatCompat` wrapper for Next 15 compatibility
- **Note**: Old flat config syntax (ESLint 9) incompatible with Next 16's new exports

### Important: firebase-admin 13.7.0
- **Reason**: Supports Application Default Credentials (Cloud Run automatic auth)
- **Current Code**: `firebaseAdmin.ts` falls back to ADC when `FIREBASE_SERVICE_ACCOUNT_KEY` env var is missing
- **Local Dev**: Uses service account key from `.env.local`
- **Cloud Run**: Uses built-in service account credentials automatically

## Key Design Decisions

### ADC Fallback (firebaseAdmin.ts)
```typescript
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
const config = serviceAccountJson
  ? { credential: cert(JSON.parse(serviceAccountJson)) }
  : {};
return initializeApp(config, ADMIN_APP_NAME);
```
- If env var is **present** (local dev): Uses explicit service account
- If env var is **missing** (Cloud Run): Uses ADC (automatic)
- Prevents "missing env var" crashes on startup

### Firebase Service Account Permissions
Ensure the Cloud Run service account has these IAM roles:
- **Firebase Authentication Admin**
- **Cloud Datastore User** (for Firestore read/write)

Check in [Google Cloud Console](https://console.cloud.google.com/iam-admin/iam):
Search for service account `ssrinternkontroll8e12a@internkontroll-8e12a.iam.gserviceaccount.com`

## Deployment Checklist

Before merging to `main`:
- [ ] Code builds locally: `npm run build`
- [ ] No ESLint errors (not just warnings)
- [ ] `.env.local` has required vars for local testing
- [ ] No package.json version changes to `next`, `eslint`, `eslint-config-next` unless Firebase Frameworks officially supports it

## Troubleshooting

### 500 Errors in Prod (but works locally)
1. Check GitHub Actions build log for version mismatches
2. Verify `eslint.config.mjs` syntax matches Next.js version
3. Check Cloud Run logs: `gcloud functions logs read ssrinternkontroll8e12a --limit 50`

### ADC/Firebase Auth Errors
1. Verify Cloud Run service account has correct IAM roles
2. In local dev, ensure `.env.local` has `FIREBASE_SERVICE_ACCOUNT_KEY`

### Build Cache Issues
- GitHub Actions caches `node_modules` by default
- If dependencies break after upgrade, manually clear cache in Actions settings

## Future Upgrades
- **Next.js 16**: Wait for Firebase Frameworks official support announcement
- **Node.js Runtime**: Currently Node 20; will be deprecated 2026-10-30 (plan upgrade to Node 22)
- **firebase-functions**: Update when Firebase provides Next.js 16 support

