/// <reference types="vite/client" />

/**
 * vite-env.d.ts
 * ----------------------------------------------------------------------------
 * Ambient type declarations for Vite's `import.meta.env`.
 *
 * The `/// <reference types="vite/client" />` directive pulls in Vite's base
 * `ImportMetaEnv` typing so `import.meta.env` is known to the TypeScript strict
 * checker. We additionally declare our project-specific env var (CONTRACT §9)
 * so `import.meta.env.VITE_API_BASE` is strongly typed wherever it is read
 * (e.g. src/api/client.ts).
 * ----------------------------------------------------------------------------
 */

interface ImportMetaEnv {
  /** Backend API base path. See CONTRACT §9 — defaults to localhost in dev. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
