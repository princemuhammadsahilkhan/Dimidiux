/**
 * DESKTOP APPLICATION DISCOVERY & NATURAL LANGUAGE RESOLUTION TESTS
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  desktopApplicationDiscoveryService,
  parseDesktopFileContent,
  parseExecField,
  isAllowedDesktopApplication,
  normalizeApplicationQuery,
  resolveApplicationByName
} from './desktopApplicationDiscoveryService.js';

async function runTests() {
  console.log('--- STARTING DESKTOP APPLICATION DISCOVERY & RESOLUTION TESTS ---');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Exec placeholder handling & parseExecField
  test('Exec placeholder handling', () => {
    const res1 = parseExecField('firefox %u');
    assert.strictEqual(res1.cleanExec, 'firefox');
    assert.strictEqual(res1.binary, 'firefox');

    const res2 = parseExecField('/usr/bin/chromium-browser %U --incognito');
    assert.strictEqual(res2.cleanExec, '/usr/bin/chromium-browser  --incognito');
    assert.strictEqual(res2.binary, 'chromium-browser');

    const res3 = parseExecField('"mousepad" %F');
    assert.strictEqual(res3.cleanExec, 'mousepad');
    assert.strictEqual(res3.binary, 'mousepad');

    const res4 = parseExecField('/usr/bin/code %f %i %c');
    assert.strictEqual(res4.cleanExec, '/usr/bin/code');
    assert.strictEqual(res4.binary, 'code');
  });

  // 2. Correct parsing of Name/GenericName/Keywords/Exec
  test('Correct parsing of Name, GenericName, Keywords, and Exec', () => {
    const content = `
[Desktop Entry]
Version=1.0
Name=Firefox Web Browser
Name[fr]=Navigateur Web Firefox
GenericName=Web Browser
Comment=Browse the World Wide Web
Exec=firefox %u
Icon=firefox
Terminal=false
Type=Application
Categories=Network;WebBrowser;
Keywords=Internet;WWW;Browser;Web;
`;
    const parsed = parseDesktopFileContent(content, '/usr/share/applications/firefox.desktop');
    assert.ok(parsed);
    assert.strictEqual(parsed.id, 'firefox');
    assert.strictEqual(parsed.name, 'Firefox Web Browser');
    assert.strictEqual(parsed.genericName, 'Web Browser');
    assert.strictEqual(parsed.exec, 'firefox %u');
    assert.strictEqual(parsed.cleanExec, 'firefox');
    assert.strictEqual(parsed.binary, 'firefox');
    assert.strictEqual(parsed.icon, 'firefox');
    assert.strictEqual(parsed.terminal, false);
    assert.strictEqual(parsed.noDisplay, false);
    assert.deepStrictEqual(parsed.keywords, ['Internet', 'WWW', 'Browser', 'Web']);
    assert.deepStrictEqual(parsed.categories, ['Network', 'WebBrowser']);
  });

  // 3. Malformed .desktop file handling
  test('Malformed .desktop file handling', () => {
    assert.strictEqual(parseDesktopFileContent(null), null);
    assert.strictEqual(parseDesktopFileContent('Not a valid file content'), null);
    assert.strictEqual(parseDesktopFileContent('[Desktop Entry]\nKeyWithoutValue'), null);
    assert.strictEqual(parseDesktopFileContent('[Desktop Entry]\nName=OnlyNameNoExec'), null);
    assert.strictEqual(parseDesktopFileContent('[Desktop Entry]\nExec=OnlyExecNoName'), null);
  });

  // 4. NoDisplay filtering
  test('NoDisplay filtering', () => {
    const normalApp = { type: 'Application', name: 'App', exec: 'app', binary: 'app', noDisplay: false, terminal: false };
    const hiddenApp = { type: 'Application', name: 'Hidden App', exec: 'app', binary: 'app', noDisplay: true, terminal: false };

    assert.strictEqual(isAllowedDesktopApplication(normalApp), true);
    assert.strictEqual(isAllowedDesktopApplication(hiddenApp, { includeNoDisplay: false }), false);
    assert.strictEqual(isAllowedDesktopApplication(hiddenApp, { includeNoDisplay: true }), true);
  });

  // 5. Terminal filtering
  test('Terminal filtering', () => {
    const guiApp = { type: 'Application', name: 'GUI App', exec: 'app', binary: 'app', noDisplay: false, terminal: false };
    const cliApp = { type: 'Application', name: 'CLI App', exec: 'app', binary: 'app', noDisplay: false, terminal: true };

    assert.strictEqual(isAllowedDesktopApplication(guiApp), true);
    assert.strictEqual(isAllowedDesktopApplication(cliApp, { includeTerminal: false }), false);
    assert.strictEqual(isAllowedDesktopApplication(cliApp, { includeTerminal: true }), true);
  });

  // 6. Dangerous executable filtering
  test('Dangerous / Administrative executable filtering', () => {
    const gpartedApp = { type: 'Application', name: 'GParted', exec: '/usr/sbin/gparted %f', binary: 'gparted', noDisplay: false, terminal: false };
    const pkexecApp = { type: 'Application', name: 'Root Term', exec: 'pkexec xterm', binary: 'xterm', noDisplay: false, terminal: false };
    const sudoApp = { type: 'Application', name: 'Sudo App', exec: 'sudo mousepad', binary: 'mousepad', noDisplay: false, terminal: false };
    const fdiskApp = { type: 'Application', name: 'Fdisk', exec: 'fdisk /dev/sda', binary: 'fdisk', noDisplay: false, terminal: false };
    const safeApp = { type: 'Application', name: 'Thunar File Manager', exec: 'thunar %F', binary: 'thunar', noDisplay: false, terminal: false };

    assert.strictEqual(isAllowedDesktopApplication(gpartedApp), false);
    assert.strictEqual(isAllowedDesktopApplication(pkexecApp), false);
    assert.strictEqual(isAllowedDesktopApplication(sudoApp), false);
    assert.strictEqual(isAllowedDesktopApplication(fdiskApp), false);
    assert.strictEqual(isAllowedDesktopApplication(safeApp), true);
  });

  // 7. Duplicate application IDs override handling
  await testAsync('Duplicate application IDs override handling', async () => {
    const tmpDir1 = path.join(os.tmpdir(), `evo_test_app_dir1_${Date.now()}`);
    const tmpDir2 = path.join(os.tmpdir(), `evo_test_app_dir2_${Date.now()}`);

    fs.mkdirSync(tmpDir1, { recursive: true });
    fs.mkdirSync(tmpDir2, { recursive: true });

    const desktopContent1 = `
[Desktop Entry]
Name=TestApp System Version
Exec=testapp-sys
Type=Application
`;
    const desktopContent2 = `
[Desktop Entry]
Name=TestApp User Override Version
Exec=testapp-user
Type=Application
`;

    fs.writeFileSync(path.join(tmpDir1, 'testapp.desktop'), desktopContent1);
    fs.writeFileSync(path.join(tmpDir2, 'testapp.desktop'), desktopContent2);

    try {
      const discovered = await desktopApplicationDiscoveryService.discoverDesktopApplications({
        directories: [tmpDir1, tmpDir2],
        forceRefresh: true
      });

      assert.strictEqual(discovered.length, 1);
      assert.strictEqual(discovered[0].id, 'testapp');
      assert.strictEqual(discovered[0].name, 'TestApp User Override Version');
      assert.strictEqual(discovered[0].cleanExec, 'testapp-user');
    } finally {
      fs.rmSync(tmpDir1, { recursive: true, force: true });
      fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
  });

  // 8. Query Normalization Tests
  test('Query normalization (action verbs, filler words, case)', () => {
    assert.strictEqual(normalizeApplicationQuery('open Firefox'), 'firefox');
    assert.strictEqual(normalizeApplicationQuery('launch Firefox browser'), 'firefox');
    assert.strictEqual(normalizeApplicationQuery('start VS Code'), 'vs code');
    assert.strictEqual(normalizeApplicationQuery('open the file manager'), 'file manager');
    assert.strictEqual(normalizeApplicationQuery('please open text editor app'), 'text editor');
    assert.strictEqual(normalizeApplicationQuery('RUN CALCULATOR'), 'calculator');
    assert.strictEqual(normalizeApplicationQuery('use web browser'), 'web browser');
  });

  // 9. Natural Language Application Resolution Tests
  await testAsync('Natural-language application resolution on system catalog', async () => {
    desktopApplicationDiscoveryService.clearCache();

    // Test 1: Firefox / open Firefox
    const resFirefox = await resolveApplicationByName('open Firefox');
    assert.strictEqual(resFirefox.success, true);
    assert.ok(resFirefox.application.id.includes('firefox'), `Expected firefox app ID, got ${resFirefox.application.id}`);
    assert.strictEqual(resFirefox.confidence, 100);

    // Test 2: VS Code / Visual Studio Code
    const resVSCode = await resolveApplicationByName('VS Code');
    assert.strictEqual(resVSCode.success, true);
    assert.strictEqual(resVSCode.application.id, 'code');

    const resVSCFull = await resolveApplicationByName('Visual Studio Code');
    assert.strictEqual(resVSCFull.success, true);
    assert.strictEqual(resVSCFull.application.id, 'code');

    // Test 3: file manager / open the file manager
    const resFM = await resolveApplicationByName('open the file manager');
    assert.strictEqual(resFM.success, true);
    assert.strictEqual(resFM.application.id, 'thunar');

    // Test 4: text editor
    const resTextEditor = await resolveApplicationByName('open text editor');
    assert.strictEqual(resTextEditor.success, true);
    assert.ok(
      resTextEditor.application.id.includes('mousepad') || resTextEditor.application.id.includes('editor'),
      `Expected mousepad or text editor app, got ${resTextEditor.application.id}`
    );

    // Test 5: calculator
    const resCalc = await resolveApplicationByName('open calculator');
    assert.strictEqual(resCalc.success, true);
    assert.ok(
      resCalc.application.id.includes('calc'),
      `Expected calculator app, got ${resCalc.application.id}`
    );

    // Test 6: Unknown application
    const resUnknown = await resolveApplicationByName('open XYZ123NonExistentApp');
    assert.strictEqual(resUnknown.success, false);
    assert.strictEqual(resUnknown.application, null);
    assert.strictEqual(resUnknown.confidence, 0);

    // Test 7: Dangerous/Admin entries (gparted, sudo, pkexec)
    const resGParted = await resolveApplicationByName('open GParted');
    assert.strictEqual(resGParted.success, false, 'gparted must never resolve');
    assert.strictEqual(resGParted.application, null);

    const resPkexec = await resolveApplicationByName('pkexec root terminal');
    assert.strictEqual(resPkexec.success, false, 'pkexec/root-terminal must never resolve');
    assert.strictEqual(resPkexec.application, null);

    // Test 8: Ambiguity handling
    const resAmbiguous = await resolveApplicationByName('settings');
    // If multiple settings entries exist with similar scores, ambiguous should be true OR a specific app should resolve if top score is 100
    if (resAmbiguous.ambiguous) {
      assert.strictEqual(resAmbiguous.success, false);
      assert.ok(Array.isArray(resAmbiguous.ambiguousCandidates));
      assert.ok(resAmbiguous.ambiguousCandidates.length > 1);
    }
  });

  console.log(`--- TEST RESULTS: ${passed} PASSED, ${failed} FAILED ---`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution exception:', err);
  process.exit(1);
});
