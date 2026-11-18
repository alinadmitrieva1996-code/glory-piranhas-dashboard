import { DashboardApp, type RenderMeta } from './ui/app.ts';

declare global {
  interface Window {
    /** Точка входа для нативной оболочки: window.PiranhasApp.render(payload, meta). */
    PiranhasApp: { render(payload: unknown, meta?: Partial<RenderMeta>): void };
  }
}

const root = document.getElementById('app');
if (root) {
  const app = new DashboardApp(root);
  window.PiranhasApp = { render: (payload, meta) => app.render(payload, meta) };
  app.render(null, { loading: true });
}
