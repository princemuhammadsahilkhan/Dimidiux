/**
 * DESKTOP APPLICATION DISCOVERY SERVICE
 * 
 * Safe, read-only discovery of installed Freedesktop (.desktop) GUI applications on Linux.
 * 
 * IMPORTANT SAFETY BOUNDARIES:
 * - Read-only scanning of application manifests (.desktop files).
 * - NEVER executes or spawns any discovered application binary.
 * - Excludes system administrative, root, and destructive tools (gparted, pkexec, sudo, fdisk, etc.).
 * - Excludes hidden/NoDisplay entries and command-line terminal utilities by default.
 * - Does not alter execution engine, autonomy policies, or existing application allowlists.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export function getHomeDir() {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      if (os && typeof os.homedir === 'function') {
        return os.homedir();
      }
    } catch (e) {}
  }
  return '';
}

export function getDefaultDesktopDirs() {
  const homeDir = getHomeDir();
  const dirs = ['/usr/share/applications'];
  if (homeDir) {
    dirs.push(path.join(homeDir, '.local/share/applications'));
  }
  return dirs;
}

const DANGEROUS_EXECUTABLES = new Set([
  'sudo', 'su', 'pkexec', 'gparted', 'gparted-bin',
  'fdisk', 'sfdisk', 'cfdisk', 'parted',
  'useradd', 'usermod', 'userdel', 'groupadd', 'groupdel',
  'passwd', 'shadow', 'chmod', 'chown', 'chgrp',
  'dd', 'mkfs', 'wipefs', 'fsck', 'badblocks',
  'reboot', 'shutdown', 'poweroff', 'init', 'systemctl',
  'gdm', 'gdm3', 'lightdm', 'sddm'
]);

const DANGEROUS_PATTERNS = [
  /\bpkexec\b/i,
  /\bsudo\b/i,
  /\bsu\s+-c\b/i,
  /\bsu\s+root\b/i,
  /\bfdisk\b/i,
  /\bgparted\b/i,
  /\buseradd\b/i,
  /\bpasswd\b/i
];

/**
 * Removes Freedesktop field codes (%f, %F, %u, %U, %i, %c, %k, etc.) from Exec strings
 * and extracts structured executable, arguments, and base binary name.
 */
export function parseExecField(rawExec) {
  if (!rawExec || typeof rawExec !== 'string') {
    return { executable: '', args: [], cleanExec: '', binary: '' };
  }

  // Remove Freedesktop field codes (%f, %F, %u, %U, %i, %c, %k, %d, %D, %n, %N, %v, %m, %%)
  let cleaned = rawExec.replace(/%[fFuUiIckdDnNvm%]/g, '').trim();
  // Remove any remaining loose placeholders like %a-%z
  cleaned = cleaned.replace(/%[a-zA-Z]/g, '').trim();

  let trimmed = cleaned.trim();
  // Strip leading/trailing outer quotes if the entire command is enclosed in quotes
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.indexOf('"', 1) === trimmed.length - 1) {
    trimmed = trimmed.substring(1, trimmed.length - 1).trim();
    cleaned = trimmed;
  }

  const tokens = [];
  const regex = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match;
  while ((match = regex.exec(trimmed)) !== null) {
    const token = match[1] || match[2] || match[3];
    if (token) tokens.push(token);
  }

  if (tokens.length === 0) {
    return { executable: '', args: [], cleanExec: '', binary: '' };
  }

  const executable = tokens[0];
  const args = tokens.slice(1);
  const binary = path.basename(executable).toLowerCase();

  return {
    executable,
    args,
    cleanExec: cleaned,
    binary
  };
}

/**
 * Parses the text content of a single .desktop file.
 */
export function parseDesktopFileContent(content, filePath = '') {
  if (typeof content !== 'string') {
    return null;
  }

  const lines = content.split(/\r?\n/);
  let inDesktopEntry = false;
  const entries = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    if (trimmed.startsWith('[')) {
      inDesktopEntry = (trimmed === '[Desktop Entry]');
      continue;
    }

    if (!inDesktopEntry) {
      continue;
    }

    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      continue;
    }

    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();

    const isLocalizedKey = key.includes('[');
    const bracketIdx = key.indexOf('[');
    const baseKey = bracketIdx !== -1 ? key.substring(0, bracketIdx).trim() : key;

    if (!isLocalizedKey) {
      entries[key] = value;
    } else if (!entries[baseKey]) {
      entries[baseKey] = value;
    }
  }

  if (!entries.Name || !entries.Exec) {
    return null;
  }

  const filename = filePath ? path.basename(filePath) : '';
  const id = filename
    ? filename.replace(/\.desktop$/i, '')
    : entries.Name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');

  const { executable, args, cleanExec, binary } = parseExecField(entries.Exec);

  const keywords = entries.Keywords
    ? entries.Keywords.split(';').map(k => k.trim()).filter(Boolean)
    : [];

  const categories = entries.Categories
    ? entries.Categories.split(';').map(c => c.trim()).filter(Boolean)
    : [];

  return {
    id,
    name: entries.Name,
    genericName: entries.GenericName || '',
    comment: entries.Comment || '',
    exec: entries.Exec,
    executable,
    args,
    cleanExec,
    binary,
    startupWMClass: entries.StartupWMClass || '',
    icon: entries.Icon || '',
    type: entries.Type || 'Application',
    terminal: /^true$/i.test(entries.Terminal || ''),
    noDisplay: /^true$/i.test(entries.NoDisplay || '') || /^true$/i.test(entries.Hidden || ''),
    keywords,
    categories,
    desktopFilePath: filePath
  };
}

/**
 * Checks if a parsed application is a safe, normal GUI desktop app.
 */
export function isAllowedDesktopApplication(app, options = {}) {
  if (!app || typeof app !== 'object') {
    return false;
  }

  if (app.type && app.type !== 'Application') {
    return false;
  }

  if (!options.includeNoDisplay && app.noDisplay) {
    return false;
  }

  if (!options.includeTerminal && app.terminal) {
    return false;
  }

  const binary = (app.binary || '').toLowerCase();
  if (DANGEROUS_EXECUTABLES.has(binary)) {
    return false;
  }

  if (DANGEROUS_PATTERNS.some(pattern => pattern.test(app.exec))) {
    return false;
  }

  return true;
}

export class DesktopApplicationDiscoveryService {
  constructor() {
    this.cachedCatalog = null;
    this.lastScanTime = 0;
  }

  /**
   * Discovers installed desktop applications.
   * Read-only scanning of .desktop directories.
   */
  async discoverDesktopApplications(options = {}) {
    const {
      directories = null,
      forceRefresh = false,
      includeTerminal = false,
      includeNoDisplay = false
    } = options;

    if (!fs || (typeof fs.existsSync !== 'function' && (!fs.promises || typeof fs.promises.readdir !== 'function'))) {
      return this.filterCatalog(this.cachedCatalog || [], { includeTerminal, includeNoDisplay });
    }

    if (this.cachedCatalog && !forceRefresh && (!options.directories || options.directories.length === 0)) {
      return this.filterCatalog(this.cachedCatalog, { includeTerminal, includeNoDisplay });
    }

    const appMap = new Map();
    const dirsToScan = (directories && directories.length > 0) ? directories : getDefaultDesktopDirs();
    const homeDir = getHomeDir();

    for (const rawDir of dirsToScan) {
      const dirPath = (rawDir && rawDir.startsWith('~'))
        ? (homeDir ? path.join(homeDir, rawDir.slice(1)) : rawDir)
        : rawDir;

      try {
        if (!fs.existsSync(dirPath)) {
          continue;
        }

        const files = await fs.promises.readdir(dirPath);
        for (const file of files) {
          if (!file.endsWith('.desktop')) {
            continue;
          }

          const fullPath = path.join(dirPath, file);
          try {
            const stat = await fs.promises.stat(fullPath);
            if (!stat.isFile()) {
              continue;
            }

            const content = await fs.promises.readFile(fullPath, 'utf8');
            const parsed = parseDesktopFileContent(content, fullPath);
            if (parsed) {
              appMap.set(parsed.id, parsed);
            }
          } catch (err) {
            // Silently ignore malformed or unreadable files
          }
        }
      } catch (err) {
        // Silently ignore directory read issues
      }
    }

    const rawCatalog = Array.from(appMap.values());
    
    // Only cache if scanning standard default directories
    if (!options.directories || options.directories.length === 0) {
      this.cachedCatalog = rawCatalog;
      this.lastScanTime = Date.now();
    }

    return this.filterCatalog(rawCatalog, { includeTerminal, includeNoDisplay });
  }

  filterCatalog(catalog, { includeTerminal = false, includeNoDisplay = false }) {
    return catalog.filter(app => isAllowedDesktopApplication(app, { includeTerminal, includeNoDisplay }));
  }

  async getDiscoveredApplications(options = {}) {
    if (!this.cachedCatalog || options.forceRefresh) {
      return this.discoverDesktopApplications(options);
    }
    return this.filterCatalog(this.cachedCatalog, options);
  }

  async getApplicationById(id, options = {}) {
    const apps = await this.getDiscoveredApplications(options);
    if (!id || typeof id !== 'string') return null;

    const query = id.toLowerCase().trim();
    // 1. Direct ID match
    let found = apps.find(app => app.id.toLowerCase() === query);
    if (found) return found;

    // 2. Name match
    found = apps.find(app => app.name.toLowerCase() === query);
    if (found) return found;

    // 3. Binary match
    found = apps.find(app => app.binary.toLowerCase() === query);
    if (found) return found;

    return null;
  }

  async searchApplications(query, options = {}) {
    const apps = await this.getDiscoveredApplications(options);
    if (!query || typeof query !== 'string') return [];

    const q = query.toLowerCase().trim();
    return apps.filter(app => {
      return (
        app.id.toLowerCase().includes(q) ||
        app.name.toLowerCase().includes(q) ||
        app.genericName.toLowerCase().includes(q) ||
        app.binary.toLowerCase().includes(q) ||
        app.keywords.some(k => k.toLowerCase().includes(q))
      );
    });
  }

  clearCache() {
    this.cachedCatalog = null;
    this.lastScanTime = 0;
  }

  /**
   * Synchronously discovers installed desktop applications.
   */
  discoverDesktopApplicationsSync(options = {}) {
    const {
      directories = null,
      forceRefresh = false,
      includeTerminal = false,
      includeNoDisplay = false
    } = options;

    if (!fs || typeof fs.existsSync !== 'function') {
      return this.filterCatalog(this.cachedCatalog || [], { includeTerminal, includeNoDisplay });
    }

    if (this.cachedCatalog && !forceRefresh && (!options.directories || options.directories.length === 0)) {
      return this.filterCatalog(this.cachedCatalog, { includeTerminal, includeNoDisplay });
    }

    const appMap = new Map();
    const dirsToScan = (directories && directories.length > 0) ? directories : getDefaultDesktopDirs();
    const homeDir = getHomeDir();

    for (const rawDir of dirsToScan) {
      const dirPath = (rawDir && rawDir.startsWith('~'))
        ? (homeDir ? path.join(homeDir, rawDir.slice(1)) : rawDir)
        : rawDir;

      try {
        if (!fs.existsSync(dirPath)) {
          continue;
        }

        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          if (!file.endsWith('.desktop')) {
            continue;
          }

          const fullPath = path.join(dirPath, file);
          try {
            const stat = fs.statSync(fullPath);
            if (!stat.isFile()) {
              continue;
            }

            const content = fs.readFileSync(fullPath, 'utf8');
            const parsed = parseDesktopFileContent(content, fullPath);
            if (parsed) {
              appMap.set(parsed.id, parsed);
            }
          } catch (err) {
            // Silently ignore malformed files
          }
        }
      } catch (err) {
        // Silently ignore directory read issues
      }
    }

    const rawCatalog = Array.from(appMap.values());
    if (!options.directories || options.directories.length === 0) {
      this.cachedCatalog = rawCatalog;
      this.lastScanTime = Date.now();
    }

    return this.filterCatalog(rawCatalog, { includeTerminal, includeNoDisplay });
  }

  getApplicationByIdSync(id, options = {}) {
    const apps = this.discoverDesktopApplicationsSync(options);
    if (!id || typeof id !== 'string') return null;

    const query = id.toLowerCase().trim();
    let found = apps.find(app => app.id.toLowerCase() === query);
    if (found) return found;

    found = apps.find(app => app.name.toLowerCase() === query);
    if (found) return found;

    found = apps.find(app => app.binary.toLowerCase() === query);
    if (found) return found;

    return null;
  }

  resolveApplicationByNameSync(query, options = {}) {
    return resolveApplicationByNameSync(query, options);
  }

  /**
   * Resolves a natural-language query to a discovered application descriptor.
   */
  async resolveApplicationByName(query, options = {}) {
    return resolveApplicationByName(query, options);
  }
}

/**
 * Common application aliases dictionary for robust natural-language mapping.
 */
export const COMMON_APP_ALIASES = {
  'firefox': ['firefox-esr', 'org.mozilla.firefox', 'firefox'],
  'browser': ['firefox-esr', 'chromium', 'google-chrome', 'default-browser'],
  'web browser': ['firefox-esr', 'chromium', 'google-chrome', 'default-browser'],
  'vs code': ['code', 'visual-studio-code', 'code-oss'],
  'vscode': ['code', 'visual-studio-code', 'code-oss'],
  'visual studio code': ['code', 'visual-studio-code', 'code-oss'],
  'text editor': ['org.xfce.mousepad', 'mousepad', 'xfce-text-editor', 'gedit', 'kate'],
  'editor': ['org.xfce.mousepad', 'mousepad', 'xfce-text-editor', 'gedit'],
  'file manager': ['thunar', 'nautilus', 'pcmanfm', 'dolphin'],
  'files': ['thunar', 'nautilus', 'pcmanfm', 'dolphin'],
  'calculator': ['mate-calc', 'gnome-calculator', 'xcalc', 'kcalc'],
  'calc': ['mate-calc', 'gnome-calculator', 'xcalc', 'kcalc'],
  'terminal': ['qterminal', 'xfce4-terminal-emulator', 'xterm', 'gnome-terminal']
};

/**
 * Normalizes natural-language query string by removing action verbs, filler words, and punctuation.
 */
export function normalizeApplicationQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return '';
  }

  let q = rawQuery.toLowerCase().trim();

  // Strip trailing punctuation (e.g. "Open Firefox." -> "Open Firefox")
  q = q.replace(/[.!?,"';:]+$/g, '').trim();

  // Strip leading polite phrases or action verbs
  q = q.replace(/^(?:please\s+)?(?:open|launch|start|run|use|show|bring\s+up|execute)\b\s*/i, '');

  // Strip leading articles
  q = q.replace(/^(?:the|a|an)\b\s*/i, '');

  q = q.trim();

  // Strip trailing "browser" if query starts with specific app name e.g. "firefox browser" -> "firefox"
  if (/^(firefox|chromium|chrome)\s+browser$/i.test(q)) {
    q = q.replace(/\s+browser$/i, '').trim();
  }

  // Strip trailing "app" or "application" e.g. "calculator app" -> "calculator"
  if (/^(.+?)\s+(?:app|application)$/i.test(q) && q !== 'app' && q !== 'application') {
    q = q.replace(/\s+(?:app|application)$/i, '').trim();
  }

  return q;
}

/**
 * Resolves a natural-language query to a discovered application descriptor using deterministic scoring.
 */
export async function resolveApplicationByName(query, options = {}) {
  const normalizedQuery = normalizeApplicationQuery(query);
  if (!normalizedQuery) {
    return {
      success: false,
      application: null,
      matchedField: null,
      matchedValue: null,
      confidence: 0,
      normalizedQuery: '',
      ambiguous: false,
      reason: 'Empty or invalid query'
    };
  }

  const catalog = await desktopApplicationDiscoveryService.getDiscoveredApplications(options);

  const scoredCandidates = [];

  for (const app of catalog) {
    if (!isAllowedDesktopApplication(app, options)) {
      continue;
    }

    const nameLower = (app.name || '').toLowerCase();
    const genericLower = (app.genericName || '').toLowerCase();
    const idLower = (app.id || '').toLowerCase();
    const binaryLower = (app.binary || '').toLowerCase();
    const keywordsLower = (app.keywords || []).map(k => k.toLowerCase());

    let score = 0;
    let matchedField = null;
    let matchedValue = null;

    // 1. Exact Name match (100)
    if (normalizedQuery === nameLower) {
      score = 100;
      matchedField = 'name';
      matchedValue = app.name;
    }
    // 2. Exact ID / Binary match (100)
    else if (normalizedQuery === idLower || normalizedQuery === binaryLower) {
      score = 100;
      matchedField = 'id';
      matchedValue = app.id;
    }
    // 3. Known Common Alias match (100)
    else if (COMMON_APP_ALIASES[normalizedQuery] && COMMON_APP_ALIASES[normalizedQuery].includes(idLower)) {
      score = 100;
      matchedField = 'alias';
      matchedValue = normalizedQuery;
    }
    // 4. Exact GenericName match (90)
    else if (genericLower && normalizedQuery === genericLower) {
      score = 90;
      matchedField = 'genericName';
      matchedValue = app.genericName;
    }
    // 5. Exact Keyword match (80)
    else if (keywordsLower.includes(normalizedQuery)) {
      score = 80;
      matchedField = 'keywords';
      matchedValue = normalizedQuery;
    }
    // 6. Name / Binary Prefix match (70)
    else if (nameLower.startsWith(normalizedQuery) || normalizedQuery.startsWith(nameLower) || binaryLower.startsWith(normalizedQuery)) {
      score = 70;
      matchedField = 'name';
      matchedValue = app.name;
    }
    // 7. GenericName Substring match (60)
    else if (genericLower && (genericLower.startsWith(normalizedQuery) || genericLower.includes(normalizedQuery))) {
      score = 60;
      matchedField = 'genericName';
      matchedValue = app.genericName;
    }
    // 8. Name or Binary Substring match (50)
    else if (nameLower.includes(normalizedQuery) || binaryLower.includes(normalizedQuery)) {
      score = 50;
      matchedField = 'name';
      matchedValue = app.name;
    }
    // 9. Keyword Substring match (40)
    else if (keywordsLower.some(k => k.includes(normalizedQuery))) {
      score = 40;
      matchedField = 'keywords';
      matchedValue = normalizedQuery;
    }

    if (score > 0) {
      scoredCandidates.push({
        app,
        score,
        matchedField,
        matchedValue
      });
    }
  }

  if (scoredCandidates.length === 0) {
    return {
      success: false,
      application: null,
      matchedField: null,
      matchedValue: null,
      confidence: 0,
      normalizedQuery,
      ambiguous: false,
      reason: `No matching application found for '${normalizedQuery}'`
    };
  }

  // Sort candidates descending by score
  scoredCandidates.sort((a, b) => b.score - a.score);

  const top = scoredCandidates[0];

  // Check for ambiguity if multiple candidates have high score close to top
  const ambiguousCandidates = scoredCandidates.filter(c => c.score >= top.score - 5 && c.score >= 50);

  if (ambiguousCandidates.length > 1 && top.score < 100) {
    return {
      success: false,
      application: null,
      matchedField: top.matchedField,
      matchedValue: top.matchedValue,
      confidence: top.score,
      normalizedQuery,
      ambiguous: true,
      ambiguousCandidates: ambiguousCandidates.map(c => ({
        id: c.app.id,
        name: c.app.name,
        score: c.score
      })),
      reason: `Ambiguous request: multiple candidates matched '${normalizedQuery}'`
    };
  }

  return {
    success: true,
    application: top.app,
    matchedField: top.matchedField,
    matchedValue: top.matchedValue,
    confidence: top.score,
    normalizedQuery,
    ambiguous: false
  };
}

export function resolveApplicationByNameSync(query, options = {}) {
  const normalizedQuery = normalizeApplicationQuery(query);
  if (!normalizedQuery) {
    return {
      success: false,
      application: null,
      matchedField: null,
      matchedValue: null,
      confidence: 0,
      normalizedQuery: '',
      ambiguous: false,
      reason: 'Empty or invalid query'
    };
  }

  const catalog = desktopApplicationDiscoveryService.discoverDesktopApplicationsSync(options);

  const scoredCandidates = [];

  for (const app of catalog) {
    if (!isAllowedDesktopApplication(app, options)) {
      continue;
    }

    const nameLower = (app.name || '').toLowerCase();
    const genericLower = (app.genericName || '').toLowerCase();
    const idLower = (app.id || '').toLowerCase();
    const binaryLower = (app.binary || '').toLowerCase();
    const keywordsLower = (app.keywords || []).map(k => k.toLowerCase());

    let score = 0;
    let matchedField = null;
    let matchedValue = null;

    if (normalizedQuery === nameLower) {
      score = 100;
      matchedField = 'name';
      matchedValue = app.name;
    } else if (normalizedQuery === idLower || normalizedQuery === binaryLower) {
      score = 100;
      matchedField = 'id';
      matchedValue = app.id;
    } else if (COMMON_APP_ALIASES[normalizedQuery] && COMMON_APP_ALIASES[normalizedQuery].includes(idLower)) {
      score = 100;
      matchedField = 'alias';
      matchedValue = normalizedQuery;
    } else if (genericLower && normalizedQuery === genericLower) {
      score = 90;
      matchedField = 'genericName';
      matchedValue = app.genericName;
    } else if (keywordsLower.includes(normalizedQuery)) {
      score = 80;
      matchedField = 'keywords';
      matchedValue = normalizedQuery;
    } else if (nameLower.startsWith(normalizedQuery) || normalizedQuery.startsWith(nameLower) || binaryLower.startsWith(normalizedQuery)) {
      score = 70;
      matchedField = 'name';
      matchedValue = app.name;
    } else if (genericLower && (genericLower.startsWith(normalizedQuery) || genericLower.includes(normalizedQuery))) {
      score = 60;
      matchedField = 'genericName';
      matchedValue = app.genericName;
    } else if (nameLower.includes(normalizedQuery) || binaryLower.includes(normalizedQuery)) {
      score = 50;
      matchedField = 'name';
      matchedValue = app.name;
    } else if (keywordsLower.some(k => k.includes(normalizedQuery))) {
      score = 40;
      matchedField = 'keywords';
      matchedValue = normalizedQuery;
    }

    if (score > 0) {
      scoredCandidates.push({
        app,
        score,
        matchedField,
        matchedValue
      });
    }
  }

  if (scoredCandidates.length === 0) {
    return {
      success: false,
      application: null,
      matchedField: null,
      matchedValue: null,
      confidence: 0,
      normalizedQuery,
      ambiguous: false,
      reason: `No matching application found for '${normalizedQuery}'`
    };
  }

  scoredCandidates.sort((a, b) => b.score - a.score);
  const top = scoredCandidates[0];
  const ambiguousCandidates = scoredCandidates.filter(c => c.score >= top.score - 5 && c.score >= 50);

  if (ambiguousCandidates.length > 1 && top.score < 100) {
    return {
      success: false,
      application: null,
      matchedField: top.matchedField,
      matchedValue: top.matchedValue,
      confidence: top.score,
      normalizedQuery,
      ambiguous: true,
      ambiguousCandidates: ambiguousCandidates.map(c => ({
        id: c.app.id,
        name: c.app.name,
        score: c.score
      })),
      reason: `Ambiguous request: multiple candidates matched '${normalizedQuery}'`
    };
  }

  return {
    success: true,
    application: top.app,
    matchedField: top.matchedField,
    matchedValue: top.matchedValue,
    confidence: top.score,
    normalizedQuery,
    ambiguous: false
  };
}

export const desktopApplicationDiscoveryService = new DesktopApplicationDiscoveryService();
export default desktopApplicationDiscoveryService;


