import Database from "better-sqlite3";
import path from "node:path";
import { choose } from "./ui-controls.mjs";
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.SMOKE_BASE_URL;
if (!base || new URL(base).port === '3000') throw new Error('Use an isolated fixture server.');
const original = (await (await fetch(base + '/api/settings')).json()).settings;
assert.equal(original.resumeText, 'SMOKE_WORKSPACE_FIXTURE', 'Refusing mutations outside the isolated fixture');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const parsed = { title: 'Водитель категории B', fields: { keywords: 'Водитель категории B', city: 'Пермь', minSalary: 90000, remoteOnly: false, resumeText: 'Желаемая должность: Водитель категории B\nОпыт работы водителем 5 лет.' }, notes: [] };
  // Simulate HH ownership verification only at the UI boundary. API ownership
  // checks and the real SQLite save are covered independently in Vitest.
  await page.route('**/api/profiles', async (route) => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON().action !== 'create') { await route.continue(); return; }
    const body=route.request().postDataJSON();assert.equal(body.resumeUrl,'https://hh.ru/resume/drivertest');
    await new Promise(resolve=>setTimeout(resolve,4500));
    const db=new Database(path.resolve('test-results/workspace-ui/fixture.db'));
    assert.equal(db.prepare('SELECT resumeText FROM Setting WHERE id=1').get().resumeText,'SMOKE_WORKSPACE_FIXTURE');
    const id=Number(db.prepare('SELECT max(id) AS id FROM Setting').get().id)+1;
    const now=Date.now();
    db.transaction(()=>{
      db.prepare('INSERT INTO Setting (id,searchAllRussia,name,city,minSalary,resumeText,resumeUrl,hhAccountId,resumeVerifiedAt,createdAt,updatedAt) VALUES (?,0,?,?,?,?,?,?,?,?,?)').run(id,parsed.title,parsed.fields.city,parsed.fields.minSalary,parsed.fields.resumeText,body.resumeUrl,'fixture-owner',now,now,now);
      db.prepare('INSERT INTO SearchKeyword (profileId,value,createdAt,updatedAt) VALUES (?,?,?,?)').run(id,parsed.fields.keywords,now,now);
      db.prepare('UPDATE AppState SET activeProfileId=? WHERE id=1').run(id);
    })();
    const profiles=db.prepare('SELECT id,name,resumeUrl FROM Setting ORDER BY id').all();db.close();
    await route.fulfill({json:{activeId:id,profiles,accountConnected:true}});
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByLabel('Рабочее резюме', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Рабочее резюме', { exact: true }).getAttribute("data-value"), '1');
  const firstStats = (await (await page.request.get(base + '/api/dashboard')).json());
  assert.equal(firstStats.vacanciesFound, 40);
  await page.getByRole('button', { name: 'Добавить резюме', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Добавить резюме', exact: true });
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Название профиля').count(), 0);
  await dialog.getByLabel('Ссылка на резюме HH', { exact: true }).fill('https://hh.ru/resume/drivertest');
  await page.screenshot({ path: 'test-results/resume-profiles-add.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Добавить и разобрать', exact: true }).click();
  await page.waitForURL(base + '/settings');
  await page.getByLabel('Рабочее резюме', { exact: true }).waitFor();
  const secondId = Number(await page.getByLabel('Рабочее резюме', { exact: true }).getAttribute("data-value"));
  assert.notEqual(secondId, 1);
  assert.equal(await page.getByLabel('Города (через запятую)', { exact: true }).inputValue(), 'Пермь');
  assert.equal(await page.getByLabel('Минимальная зарплата', { exact: true }).inputValue(), '90000');
  const second = (await (await page.request.get(base + '/api/settings')).json()).settings;
  assert.equal(second.name, 'Водитель категории B');
  assert.equal(second.keywords[0].value, 'Водитель категории B');
  assert.equal(second.resumeUrl, 'https://hh.ru/resume/drivertest');
  await page.screenshot({ path: 'test-results/resume-profiles-settings.png', fullPage: true });
  await page.goto(base);
  const secondStats = await (await page.request.get(base + '/api/dashboard')).json();
  assert.equal(secondStats.vacanciesFound, 0); assert.equal(secondStats.appliedToday, 0); assert.equal(secondStats.pending, 0);
  const secondLogs = await (await page.request.get(base + '/api/logs')).json();
  assert.ok(secondLogs.logs.every((row) => row.message !== 'SMOKE_INFO'));
  await page.getByRole('link', { name: 'Вакансии', exact: true }).click();
  await page.getByText('Ничего не найдено. Измените фильтры или запустите поиск вакансий.').waitFor();
  await choose(page.getByLabel('Рабочее резюме', { exact: true }), '1');
  await page.waitForFunction(() => document.querySelector('[role="combobox"][aria-label="Рабочее резюме"]')?.dataset.value === '1');
  const restored = await (await page.request.get(base + '/api/dashboard')).json();
  assert.equal(restored.vacanciesFound, firstStats.vacanciesFound); assert.equal(restored.appliedToday, firstStats.appliedToday);
  assert.equal((await (await page.request.get(base + '/api/settings')).json()).settings.resumeText, 'SMOKE_WORKSPACE_FIXTURE');
  await page.goto(base + '/settings');
  await page.getByLabel('Города (через запятую)', { exact: true }).fill('Несохранённый город');
  page.once('dialog', (event) => event.dismiss());
  await choose(page.getByLabel('Рабочее резюме', { exact: true }), String(secondId));
  assert.equal(await page.getByLabel('Рабочее резюме', { exact: true }).getAttribute("data-value"), '1');
  assert.equal(await page.getByLabel('Города (через запятую)', { exact: true }).inputValue(), 'Несохранённый город');
  page.once('dialog', (event) => event.accept());
  await choose(page.getByLabel('Рабочее резюме', { exact: true }), String(secondId));
  await page.getByLabel('Города (через запятую)', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[role="combobox"][aria-label="Рабочее резюме"]')?.dataset.value !== '1');
  assert.equal(await page.getByLabel('Города (через запятую)', { exact: true }).inputValue(), 'Пермь');
  const stale = await page.request.put(base + '/api/settings', { data: { profileId: 1, city: 'Чужие правки' } });
  assert.equal(stale.status(), 409);
  const invalid = await page.request.post(base + '/api/profiles', { data: { action: 'create', profileId: secondId, resumeUrl: 'https://hh.ru/resume/drivertest?from=profile' } });
  assert.equal(invalid.status(), 409);

  const otherTab = await page.context().newPage();
  await otherTab.goto(base + '/auto-apply');
  await otherTab.getByLabel('Рабочее резюме', { exact: true }).waitFor();
  await choose(page.getByLabel('Рабочее резюме', { exact: true }), '1');
  await otherTab.waitForFunction(() => document.querySelector('[role="combobox"][aria-label="Рабочее резюме"]')?.dataset.value === '1');
  await otherTab.close();
  for (const pathname of ['/', '/vacancies', '/auto-apply', '/settings']) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + pathname);
    await page.getByLabel('Рабочее резюме', { exact: true }).waitFor();
    const dimensions = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
    assert.ok(dimensions.content <= dimensions.width, pathname + ' overflow: ' + JSON.stringify(dimensions));
  }
  await page.getByRole('button', { name: 'Добавить резюме', exact: true }).click();
  await page.screenshot({ path: 'test-results/resume-profiles-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('OK profile import with automatic HH title, isolated settings/stats/vacancies/logs, restored history, unsaved edit confirmation, stale-tab guard, duplicate URL guard, second-tab sync and 390px layout.');
  console.log('Only the isolated fixture database was changed; HH parsing used a local response fixture.');
} finally { await browser.close(); }
