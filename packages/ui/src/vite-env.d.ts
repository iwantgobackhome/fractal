/**
 * Vite asset imports used by the client.
 *
 * Declared locally instead of pulling in `vite/client`, so the project's
 * explicit `types` list in tsconfig stays untouched.
 */
declare module '*?url' {
  const src: string;
  export default src;
}

declare module '*.css' {
  const content: string;
  export default content;
}

/** What the Electron shell exposes to the page (absent in a plain browser). */
interface FractalDesktop {
  version?: string;
  savePdf(options: { suggestedName: string }): Promise<{ saved: boolean; path?: string }>;
}

interface Window {
  fractalDesktop?: FractalDesktop;
}
