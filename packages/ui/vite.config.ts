import { defineConfig } from 'vite';
export default defineConfig(({ command }) => ({
  plugins: command === 'serve' ? [{
    name: 'fractal-local-token',
    async transformIndexHtml(html: string) {
      const response = await fetch('http://127.0.0.1:7327/');
      if (!response.ok) throw new Error('Fractal hub is unavailable on port 7327');
      const served = await response.text();
      const meta = served.match(/<meta name="paperread-token" content="[0-9a-f]+">/i)?.[0];
      if (meta === undefined) throw new Error('Fractal hub did not supply a page token');
      return html.replace('</head>', `${meta}</head>`);
    },
  }] : [],
  build: {
    outDir: 'dist',
    // Fonts are never inlined as data: URLs. The entry page's CSP (default-src 'self') refuses
    // data: fonts, and KaTeX ships a few woff2 files small enough to be inlined otherwise.
    assetsInlineLimit: (file) => (/\.(?:woff2?|ttf)$/i.test(file) ? false : undefined),
  },
  server: { host: '127.0.0.1', proxy: { '/api': { target: 'http://127.0.0.1:7327', changeOrigin: true } } },
}));
