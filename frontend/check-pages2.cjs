const { chromium } = require('./node_modules/playwright');
(async () => {
  const browser = await chromium.launch();
  const base = 'http://127.0.0.1:4173';
  const routes = [
    '/workspace/dashboard', '/project/tasks', '/portal/portal-projects',
    '/p404', '/loading', '/', '/login',
  ];
  for (const route of routes) {
    const page = await browser.newPage();
    try {
      await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(800);
      const info = await page.evaluate(() => {
        const sheets = Array.from(document.styleSheets).map(ss => ({
          href: ss.href || '(injected)',
          dw: (ss.cssRules ? Array.from(ss.cssRules).map(r => r.cssText).join('').split('--dw-').length - 1 : 0)
        }));
        const body = document.body;
        const cs = getComputedStyle(body);
        return { sheets, bg: cs.backgroundColor, font: cs.fontFamily };
      });
      console.log(`\n=== ${route} ===`);
      for (const s of info.sheets) {
        const name = s.href ? s.href.split('/').pop() : 'injected';
        console.log(`  ${name.padEnd(40)} dw:${String(s.dw).padStart(3)}`);
      }
      console.log(`  body bg=${info.bg} font=${info.font}`);
    } catch (e) {
      console.log(`=== ${route} ERR ${e.message.slice(0,60)} ===`);
    } finally {
      await page.close();
    }
  }
  await browser.close();
})();
