const { chromium } = require('./node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const base = 'http://127.0.0.1:4173';
  const routes = [
    '/', '/login', '/register', '/pricing', '/forgot-password',
    '/reset-password?token=abc', '/invitation?token=abc', '/onboarding',
    '/workspace/dashboard', '/workspace/projects', '/workspace/my-tasks',
    '/workspace/documents', '/workspace/reports', '/workspace/notifications',
    '/workspace/reviews', '/workspace/clients', '/workspace/account',
    '/workspace/settings', '/workspace/team', '/workspace/audit',
    '/project', '/project/files', '/project/tasks', '/project/task/1',
    '/project/discussions', '/project/deliverables', '/project/milestones',
    '/project/review', '/project/access', '/project/activity',
    '/portal/portal-projects', '/portal/portal-project/1',
    '/portal/portal-deliverables/1', '/portal/portal-review/1',
    '/portal/portal-account', '/portal/portal-notifications', '/portal/portal-updates',
    '/p404', '/loading',
  ];

  const results = [];
  for (const route of routes) {
    const page = await browser.newPage();
    try {
      await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(800);
      const info = await page.evaluate(() => {
        const html = document.documentElement;
        const styles = Array.from(document.styleSheets).map(ss => {
          try { return Array.from(ss.cssRules || []); } catch { return []; }
        }).flat();
        const sheetTexts = styles.map(r => r.cssText).join('');
        const fonts = Array.from(new Set(styles.map(r => r.cssText).join('').match(/:root\{([^}]*)\}/)?.[1] || ''))
          .map(s => s.split(':').slice(0,2).join(':'))
          .join('; ');
        const title = document.title;
        const h1 = document.querySelector('h1')?.textContent || '—';
        const h2 = document.querySelector('h2')?.textContent || '—';
        const hasTable = !!document.querySelector('table');
        const bodyText = (document.body.textContent || '').trim().slice(0, 120);
        return {
          dwLeaks: sheetTexts.split('--dw-').length - 1,
          hOvf: html.scrollWidth > window.innerWidth ? Math.round(html.scrollWidth - window.innerWidth) : 0,
          vOvf: html.scrollHeight > window.innerHeight ? Math.round(html.scrollHeight - window.innerHeight) : 0,
          hasStyles: document.styleSheets.length,
          title: title,
          h1: h1, h2: h2, hasTable: hasTable, bodyText: bodyText
        };
      });
      results.push({ route, ...info });
    } catch (e) {
      results.push({ route, error: e.message.slice(0, 70) });
    } finally {
      await page.close();
    }
  }
  await browser.close();
  console.log(`TOTAL: ${routes.length} pages\n`.padEnd(100, '='));
  let leaks = 0, hover = 0;
  for (const r of results) {
    if (r.error) { console.log(`${r.route.padEnd(38)} ERR: ${r.error}`); continue; }
    if (r.dwLeaks > 0) leaks++;
    if (r.hOvf > 0) hover++;
    const mark = r.dwLeaks > 0 ? '  <-- DW LEAK' : (r.hOvf > 0 ? '  <-- HOVERFLOW' : '');
    console.log(`${r.route.padEnd(38)} dw:${String(r.dwLeaks).padStart(3)} hOvf:${String(r.hOvf).padStart(4)} h1:${r.h1.slice(0,25).padEnd(27)} title:${r.title.slice(0,35)}${mark}`);
  }
  console.log(`\n=== SUMMARY: dw-leaks=${leaks} | h-overflow=${hover} | errors=${results.filter(r=>r.error).length} ===`);
  return results;
})();
