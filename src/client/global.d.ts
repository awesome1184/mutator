declare module '*.css';

interface ImportMetaEnv {
  readonly VITE_STANDALONE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
