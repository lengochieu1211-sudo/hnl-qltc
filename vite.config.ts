import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

const firebaseWebConfig = (() => {
  try {
    return process.env.FIREBASE_WEBAPP_CONFIG
      ? JSON.parse(process.env.FIREBASE_WEBAPP_CONFIG)
      : {};
  } catch {
    return {};
  }
})();

const firebaseEnvFallbacks: Record<string, string | undefined> = {
  'import.meta.env.VITE_FIREBASE_API_KEY': process.env.VITE_FIREBASE_API_KEY || firebaseWebConfig.apiKey,
  'import.meta.env.VITE_FIREBASE_AUTH_DOMAIN': process.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseWebConfig.authDomain,
  'import.meta.env.VITE_FIREBASE_PROJECT_ID': process.env.VITE_FIREBASE_PROJECT_ID || firebaseWebConfig.projectId,
  'import.meta.env.VITE_FIREBASE_STORAGE_BUCKET': process.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseWebConfig.storageBucket,
  'import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID': process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseWebConfig.messagingSenderId,
  'import.meta.env.VITE_FIREBASE_APP_ID': process.env.VITE_FIREBASE_APP_ID || firebaseWebConfig.appId,
  'import.meta.env.VITE_FIREBASE_MEASUREMENT_ID': process.env.VITE_FIREBASE_MEASUREMENT_ID || firebaseWebConfig.measurementId,
  'import.meta.env.VITE_FIRESTORE_DATABASE_ID': process.env.VITE_FIRESTORE_DATABASE_ID || '(default)',
};

const firebaseEnvDefine = Object.fromEntries(
  Object.entries(firebaseEnvFallbacks)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, JSON.stringify(value)])
);

export default defineConfig(() => {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const vnOffset = 7; // Vietnam is UTC+7
  const vnDate = new Date(utc + 3600000 * vnOffset);
  const dd = String(vnDate.getDate()).padStart(2, '0');
  const mm = String(vnDate.getMonth() + 1).padStart(2, '0');
  const yyyy = vnDate.getFullYear();
  const hh = String(vnDate.getHours()).padStart(2, '0');
  const min = String(vnDate.getMinutes()).padStart(2, '0');
  const buildTimeStr = `${dd}/${mm}/${yyyy} ${hh}:${min}`;

  return {
    plugins: [react(), tailwindcss()],
    define: {
      ...firebaseEnvDefine,
      __BUILD_TIME__: JSON.stringify(buildTimeStr),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: true,
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'index.html'),
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('pdfjs-dist') || id.includes('jspdf') || id.includes('xlsx')) {
                return 'vendor-heavy';
              }
              return 'vendor';
            }
          }
        }
      }
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
