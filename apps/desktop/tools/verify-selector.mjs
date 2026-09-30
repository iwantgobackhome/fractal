// Exercises the production component with deliberately changing model lists.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
const root = resolve(import.meta.dirname, '../../..');
const output = resolve(root, 'docs/implementation/desktop/stage1');
const bundle = await build({
  stdin: {
    resolveDir: root,
    loader: 'tsx',
    contents: `
  import React, {useState} from 'react';
  import {createRoot} from 'react-dom/client';
  import {Selector} from './packages/ui/src/components/Selector';
  function Fixture() {
    const [options,setOptions] = useState(Array.from({length:60},(_,i)=>({value:String(i),label:'Model '+i+' with a deliberately long descriptive name for viewport and wrapping verification',disabled:i===58})));
    const [value,setValue] = useState('0'); const [loading,setLoading] = useState(false);
    window.updateOptions=setOptions; window.updateLoading=setLoading;
    return <div style={{height:140,overflow:'hidden',marginTop:590,border:'1px solid'}}><Selector label="Verification model" value={value} onChange={setValue} options={options} loading={loading}/><button id="outside">Outside</button><output id="value">{value}</output></div>;
  }
  createRoot(document.getElementById('root')).render(<Fixture/>);
`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const browser = await chromium.launch({
  executablePath: process.env.FRACTAL_REVIEW_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.setContent('<html><body style="margin:16px"><div id="root"></div></body></html>');
  const css = await Promise.all(['tokens.css', 'index.css'].map((file) => readFile(resolve(root, 'packages/ui/src/design/' + file), 'utf8')));
  await page.addStyleTag({ content: css.join('\n') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const trigger = page.getByRole('combobox', { name: 'Verification model' });
  await trigger.focus();
  await trigger.press('End');
  assert.equal(await page.locator('[role="option"][data-active="true"]').getAttribute('id'), await trigger.getAttribute('aria-activedescendant'));
  assert.ok((await page.locator('[role="option"][data-active="true"]').textContent()).startsWith('Model 59 '));
  await trigger.press('Escape');
  await trigger.press('Home');
  assert.ok((await page.locator('[role="option"][data-active="true"]').textContent()).startsWith('Model 0 '));
  await trigger.press('Escape');
  await trigger.focus();
  await trigger.press('ArrowDown');
  await trigger.press('End');
  assert.equal(
    await page.locator('[role="option"][data-active="true"]').textContent(),
    'Model 59 with a deliberately long descriptive name for viewport and wrapping verification',
  );
  const bounds = await page.getByRole('listbox').boundingBox();
  assert.ok(bounds && bounds.y >= 12 && bounds.y + bounds.height <= 788);
  const last = await page.locator('[role="option"][data-active="true"]').boundingBox();
  assert.ok(last && bounds && last.y >= bounds.y && last.y + last.height <= bounds.y + bounds.height);
  await page.screenshot({ path: resolve(output, 'selector-long-list-bottom.png') });
  await trigger.press('ArrowUp');
  assert.equal(await page.locator('[role="option"][data-active="true"]').getAttribute('aria-disabled'), null, 'Disabled model is skipped');
  await trigger.press('Home');
  await trigger.press('ArrowDown');
  await trigger.press('Enter');
  assert.equal(await page.locator('#value').textContent(), '1');
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);
  await trigger.press('ArrowDown');
  await trigger.press('End');
  await page.evaluate(() =>
    window.updateOptions([
      { value: 'new', label: 'New model' },
      { value: '59', label: 'Preserved active model' },
      { value: '1', label: 'Selected model' },
    ]),
  );
  await page.getByRole('option', { name: 'Preserved active model' }).waitFor();
  assert.equal(await page.locator('[role="option"][data-active="true"]').textContent(), 'Preserved active model');
  await page.evaluate(() =>
    window.updateOptions([
      { value: 'new', label: 'New model', disabled: true },
      { value: '1', label: 'Selected model' },
    ]),
  );
  await page.getByRole('option', { name: 'Selected model' }).waitFor();
  const activeId = await trigger.getAttribute('aria-activedescendant');
  assert.equal(await page.locator(`[id="${activeId}"]`).count(), 1);
  await page.getByRole('option', { name: 'New model' }).click({ force: true });
  assert.equal(await page.locator('#value').textContent(), '1');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  await trigger.press('Escape');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);
  await trigger.click();
  await page.locator('#outside').click();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await trigger.click();
  await trigger.press('Tab');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await trigger.click();
  await page.evaluate(() => window.updateLoading(true));
  await page.waitForFunction(() => document.querySelector('[role="combobox"]').disabled);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await page.evaluate(() => {
    window.updateLoading(false);
    window.updateOptions([]);
  });
  await page.waitForFunction(() => document.querySelector('[role="combobox"]').disabled);
  assert.equal(await trigger.getAttribute('aria-activedescendant'), null);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(output, 'selector-verification.json'),
    JSON.stringify(
      {
        passed: true,
        keyboard: true,
        disabledSkipped: true,
        disabledNeverSelected: true,
        activeValuePreservedOnReorder: true,
        activeDescendantValidOnRemoval: true,
        loadingAndEmptyDisable: true,
        escapeFocus: true,
        outsideAndTabClose: true,
        viewportAndOverflowContainment: bounds,
        longListEndVisible: last,
        exceptions: errors,
      },
      null,
      2,
    ),
  );
  console.log('Production Selector dynamic-list and viewport checks passed.');
} finally {
  await browser.close();
}
