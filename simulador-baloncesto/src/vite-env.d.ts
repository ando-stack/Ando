/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: 'static' | 'supabase';
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
