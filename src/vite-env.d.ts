/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __BUILD_HASH__: string
declare const __BUILD_TIME__: string

// Vite raw imports — used by the guard-drift test to read the Netlify function's
// source without pulling @types/node in for a single assertion.
declare module '*?raw' {
  const content: string
  export default content
}
