import { fsConfig } from '../config/fsConfig.js';
import { computeFingerprint } from './transactionStore.js';

/**
 * Virtual Workspace Store for Browser Environment
 */
const virtualWorkspace = {
  '/home/kali/Desktop/Evo/workspace': { type: 'directory' },
  '/home/kali/Desktop/Evo/workspace/README.md': { type: 'file', content: '# EVO Agent Workspace\nWelcome to EVO Desktop Agent.', size: 48 },
  '/home/kali/Desktop/Evo/workspace/notes.txt': { type: 'file', content: 'Notes on research project', size: 25 },
  '/home/kali/Desktop/Evo/workspace/Research': { type: 'directory' },
  '/home/kali/Desktop/Evo/workspace/Research/paper1.txt': { type: 'file', content: 'Paper 1: Autonomous Agent Architecture', size: 38 },
  '/home/kali/Desktop/Evo/workspace/Research/paper2.txt': { type: 'file', content: 'Paper 2: Deterministic Planning Systems', size: 39 },
  '/home/kali/Desktop': { type: 'directory' }
};

function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

export function isDesktopTarget(requestedPath) {
  if (!requestedPath || typeof requestedPath !== 'string') return false;
  const normDesktopRoot = fsConfig.desktopRoot ? normalizePath(fsConfig.desktopRoot) : '/home/kali/Desktop';
  const rawSub = requestedPath.trim();
  return (
    rawSub === 'Desktop' ||
    rawSub === 'Desktop/' ||
    rawSub.startsWith('Desktop/') ||
    rawSub.startsWith(normDesktopRoot)
  );
}

/**
 * Centralized Security Boundary Check
 */
export function resolveSafePath(requestedPath, root = fsConfig.workspaceRoot) {
  if (requestedPath === null || requestedPath === undefined || typeof requestedPath !== 'string') {
    throw new Error('Path must be a valid string.');
  }

  if (requestedPath.indexOf('\0') !== -1) {
    throw new Error('Security Error: Null byte in path.');
  }

  const normRoot = normalizePath(root);
  const normDesktopRoot = fsConfig.desktopRoot ? normalizePath(fsConfig.desktopRoot) : '/home/kali/Desktop';
  const rawSub = requestedPath.trim();

  const segments = rawSub.split('/');
  if (segments.includes('..') || rawSub.startsWith('../') || rawSub.includes('/../')) {
    throw new Error(`Security Error: Traversal attempt detected in path "${requestedPath}".`);
  }

  // Handle explicit Desktop path requests
  const isDesktopTarget = rawSub === 'Desktop' || rawSub === 'Desktop/' || rawSub.startsWith('Desktop/') || rawSub.startsWith(normDesktopRoot);

  let fullPath;
  if (isDesktopTarget) {
    if (rawSub === 'Desktop' || rawSub === 'Desktop/') {
      fullPath = normDesktopRoot;
    } else if (rawSub.startsWith(normDesktopRoot)) {
      fullPath = normalizePath(rawSub);
    } else if (rawSub.startsWith('Desktop/')) {
      const sub = rawSub.substring('Desktop/'.length);
      fullPath = normalizePath(`${normDesktopRoot}/${sub}`);
    } else {
      fullPath = normalizePath(`${normDesktopRoot}/${rawSub}`);
    }

    if (!fullPath.startsWith(normDesktopRoot)) {
      throw new Error(`Security Error: Path "${requestedPath}" escapes Desktop boundary "${normDesktopRoot}".`);
    }
    return fullPath;
  }

  if (rawSub === '' || rawSub === '.') {
    fullPath = normRoot;
  } else if (rawSub.startsWith(normRoot)) {
    fullPath = normalizePath(rawSub);
  } else if (rawSub.startsWith('/')) {
    fullPath = normalizePath(rawSub);
  } else {
    fullPath = normalizePath(`${normRoot}/${rawSub}`);
  }

  if (!fullPath.startsWith(normRoot)) {
    throw new Error(`Security Error: Path "${requestedPath}" escapes workspace boundary "${normRoot}".`);
  }

  return fullPath;
}

/**
 * Tool 1: listDirectory(path)
 */
export async function listDirectory(requestedPath = '.', root = fsConfig.workspaceRoot) {
  const safePath = resolveSafePath(requestedPath, root);

  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      if (!fs.existsSync(safePath)) {
        throw new Error(`Directory not found: "${requestedPath}"`);
      }
      const stat = fs.statSync(safePath);
      if (!stat.isDirectory()) {
        throw new Error(`Path is not a directory: "${requestedPath}"`);
      }
      const files = fs.readdirSync(safePath);
      const entries = files.map((name) => {
        const itemPath = `${safePath}/${name}`;
        const itemStat = fs.statSync(itemPath);
        return {
          name,
          type: itemStat.isDirectory() ? 'directory' : 'file',
          size: itemStat.size
        };
      });
      return {
        success: true,
        path: requestedPath,
        resolvedPath: safePath,
        entries
      };
    } catch (err) {
      if (err.message && err.message.startsWith('Security Error')) throw err;
      throw new Error(`listDirectory failed: ${err.message}`);
    }
  }

  const normPath = normalizePath(safePath);
  const item = virtualWorkspace[normPath];
  if (!item || item.type !== 'directory') {
    throw new Error(`Directory not found or invalid: "${requestedPath}"`);
  }

  const prefix = normPath === '/' ? '' : normPath;
  const entries = [];
  for (const key of Object.keys(virtualWorkspace)) {
    if (key !== normPath && key.startsWith(prefix)) {
      const relative = key.slice(prefix.length).replace(/^\//, '');
      if (relative && !relative.includes('/')) {
        entries.push({
          name: relative,
          type: virtualWorkspace[key].type,
          size: virtualWorkspace[key].size || 0
        });
      }
    }
  }

  return {
    success: true,
    path: requestedPath,
    resolvedPath: normPath,
    entries
  };
}

/**
 * Tool 2: readFile(path)
 */
export async function readFile(requestedPath, root = fsConfig.workspaceRoot) {
  const safePath = resolveSafePath(requestedPath, root);

  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      if (!fs.existsSync(safePath)) {
        throw new Error(`File not found: "${requestedPath}"`);
      }
      const stat = fs.statSync(safePath);
      if (stat.isDirectory()) {
        throw new Error(`Path is a directory, not a file: "${requestedPath}"`);
      }
      const content = fs.readFileSync(safePath, 'utf-8');
      return {
        success: true,
        path: requestedPath,
        resolvedPath: safePath,
        content,
        size: stat.size,
        fingerprint: computeFingerprint(content)
      };
    } catch (err) {
      if (err.message && err.message.startsWith('Security Error')) throw err;
      throw new Error(`readFile failed: ${err.message}`);
    }
  }

  const normPath = normalizePath(safePath);
  const item = virtualWorkspace[normPath];
  if (!item || item.type !== 'file') {
    throw new Error(`File not found or invalid: "${requestedPath}"`);
  }

  return {
    success: true,
    path: requestedPath,
    resolvedPath: normPath,
    content: item.content,
    size: item.size,
    fingerprint: computeFingerprint(item.content)
  };
}

/**
 * Tool 3: createDirectory(path)
 */
export async function createDirectory(requestedPath, root = fsConfig.workspaceRoot) {
  const safePath = resolveSafePath(requestedPath, root);

  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      if (fs.existsSync(safePath)) {
        const stat = fs.statSync(safePath);
        if (stat.isDirectory()) {
          return { success: true, path: requestedPath, resolvedPath: safePath, created: false };
        }
        throw new Error(`Path "${requestedPath}" exists and is a file.`);
      }
      fs.mkdirSync(safePath, { recursive: true });
      return { success: true, path: requestedPath, resolvedPath: safePath, created: true };
    } catch (err) {
      if (err.message && err.message.startsWith('Security Error')) throw err;
      throw new Error(`createDirectory failed: ${err.message}`);
    }
  }

  const normPath = normalizePath(safePath);
  virtualWorkspace[normPath] = { type: 'directory' };
  return { success: true, path: requestedPath, resolvedPath: normPath, created: true };
}

/**
 * Tool 4: writeFile(path, content, overwriteConfirmation)
 */
export async function writeFile(requestedPath, content, overwriteConfirmation = false, root = fsConfig.workspaceRoot) {
  const safePath = resolveSafePath(requestedPath, root);
  const textContent = content !== undefined ? String(content) : '';

  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      const existed = fs.existsSync(safePath);
      let previousContent = null;

      if (existed) {
        const stat = fs.statSync(safePath);
        if (stat.isDirectory()) {
          throw new Error(`Target path "${requestedPath}" is a directory.`);
        }
        if (!overwriteConfirmation) {
          throw new Error(`Overwrite Protection Error: Target file "${requestedPath}" already exists. Explicit overwrite confirmation required.`);
        }
        previousContent = fs.readFileSync(safePath, 'utf-8');
      }

      // Ensure parent directory exists
      const pathModule = await import('path');
      const parentDir = pathModule.dirname(safePath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Atomic write pattern: write to temp file then rename
      const tempPath = `${safePath}.tmp_${Date.now()}`;
      fs.writeFileSync(tempPath, textContent, 'utf-8');
      fs.renameSync(tempPath, safePath);

      const newSize = Buffer.byteLength(textContent, 'utf-8');
      const newFp = computeFingerprint(textContent);

      return {
        success: true,
        path: requestedPath,
        resolvedPath: safePath,
        previousState: {
          existed,
          content: previousContent,
          fingerprint: computeFingerprint(previousContent)
        },
        newState: {
          existed: true,
          content: textContent,
          size: newSize,
          fingerprint: newFp
        }
      };
    } catch (err) {
      if (err.message && (err.message.startsWith('Security Error') || err.message.startsWith('Overwrite Protection Error'))) throw err;
      throw new Error(`writeFile failed: ${err.message}`);
    }
  }

  const normPath = normalizePath(safePath);
  const existed = !!virtualWorkspace[normPath];
  let previousContent = null;
  if (existed) {
    if (!overwriteConfirmation) {
      throw new Error(`Overwrite Protection Error: Target file "${requestedPath}" already exists. Explicit overwrite confirmation required.`);
    }
    previousContent = virtualWorkspace[normPath].content;
  }

  virtualWorkspace[normPath] = {
    type: 'file',
    content: textContent,
    size: textContent.length
  };

  return {
    success: true,
    path: requestedPath,
    resolvedPath: normPath,
    previousState: {
      existed,
      content: previousContent,
      fingerprint: computeFingerprint(previousContent)
    },
    newState: {
      existed: true,
      content: textContent,
      size: textContent.length,
      fingerprint: computeFingerprint(textContent)
    }
  };
}

/**
 * Tool 5: copyFile(source, destination)
 */
export async function copyFile(sourcePath, destPath, root = fsConfig.workspaceRoot) {
  const safeSource = resolveSafePath(sourcePath, root);
  const safeDest = resolveSafePath(destPath, root);

  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      if (!fs.existsSync(safeSource)) {
        throw new Error(`Source file not found: "${sourcePath}"`);
      }
      const srcStat = fs.statSync(safeSource);
      if (srcStat.isDirectory()) {
        throw new Error(`Source "${sourcePath}" is a directory, not a file.`);
      }

      const pathModule = await import('path');
      const destDir = pathModule.dirname(safeDest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const content = fs.readFileSync(safeSource, 'utf-8');
      fs.writeFileSync(safeDest, content, 'utf-8');

      return {
        success: true,
        source: sourcePath,
        destination: destPath,
        resolvedSource: safeSource,
        resolvedDestination: safeDest,
        fingerprint: computeFingerprint(content),
        size: srcStat.size
      };
    } catch (err) {
      if (err.message && err.message.startsWith('Security Error')) throw err;
      throw new Error(`copyFile failed: ${err.message}`);
    }
  }

  const normSrc = normalizePath(safeSource);
  const normDest = normalizePath(safeDest);
  const srcItem = virtualWorkspace[normSrc];
  if (!srcItem || srcItem.type !== 'file') {
    throw new Error(`Source file not found or invalid: "${sourcePath}"`);
  }

  virtualWorkspace[normDest] = { ...srcItem };
  return {
    success: true,
    source: sourcePath,
    destination: destPath,
    resolvedSource: normSrc,
    resolvedDestination: normDest,
    fingerprint: computeFingerprint(srcItem.content),
    size: srcItem.size
  };
}

/**
 * Tool 6: moveFile(source, destination)
 */
export async function moveFile(sourcePath, destPath, root = fsConfig.workspaceRoot) {
  const safeSource = resolveSafePath(sourcePath, root);
  const safeDest = resolveSafePath(destPath, root);

  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      if (!fs.existsSync(safeSource)) {
        throw new Error(`Source file not found: "${sourcePath}"`);
      }

      const pathModule = await import('path');
      const destDir = pathModule.dirname(safeDest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      const content = fs.readFileSync(safeSource, 'utf-8');
      fs.renameSync(safeSource, safeDest);

      return {
        success: true,
        source: sourcePath,
        destination: destPath,
        resolvedSource: safeSource,
        resolvedDestination: safeDest,
        fingerprint: computeFingerprint(content)
      };
    } catch (err) {
      if (err.message && err.message.startsWith('Security Error')) throw err;
      throw new Error(`moveFile failed: ${err.message}`);
    }
  }

  const normSrc = normalizePath(safeSource);
  const normDest = normalizePath(safeDest);
  const srcItem = virtualWorkspace[normSrc];
  if (!srcItem) {
    throw new Error(`Source file not found: "${sourcePath}"`);
  }

  virtualWorkspace[normDest] = { ...srcItem };
  delete virtualWorkspace[normSrc];

  return {
    success: true,
    source: sourcePath,
    destination: destPath,
    resolvedSource: normSrc,
    resolvedDestination: normDest,
    fingerprint: computeFingerprint(srcItem.content)
  };
}

/**
 * Tool 7: renameFile(source, destination)
 */
export async function renameFile(sourcePath, destPath, root = fsConfig.workspaceRoot) {
  return moveFile(sourcePath, destPath, root);
}

/**
 * Tool 8: searchFiles(query, requestedPath)
 */
export async function searchFiles(query, requestedPath = '.', root = fsConfig.workspaceRoot) {
  if (!query || typeof query !== 'string') {
    throw new Error('Query must be a non-empty string.');
  }

  const safePath = resolveSafePath(requestedPath, root);
  const lowerQuery = query.toLowerCase();
  const matches = [];

  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('fs');
      function walkDir(dir) {
        if (!fs.existsSync(dir)) return;
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = `${dir}/${item}`;
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            walkDir(fullPath);
          } else if (item.toLowerCase().includes(lowerQuery)) {
            matches.push({
              name: item,
              path: fullPath.replace(`${root}/`, ''),
              fullPath,
              size: stat.size
            });
          }
        }
      }
      walkDir(safePath);
      return {
        success: true,
        query,
        path: requestedPath,
        matches
      };
    } catch (err) {
      if (err.message && err.message.startsWith('Security Error')) throw err;
      throw new Error(`searchFiles failed: ${err.message}`);
    }
  }

  const normPath = normalizePath(safePath);
  const prefix = normPath === '/' ? '' : normPath;
  for (const key of Object.keys(virtualWorkspace)) {
    if (key.startsWith(prefix) && key.toLowerCase().includes(lowerQuery)) {
      matches.push({
        name: key.split('/').pop(),
        path: key,
        size: virtualWorkspace[key].size || 0
      });
    }
  }

  return {
    success: true,
    query,
    path: requestedPath,
    matches
  };
}

export const filesystemTool = {
  listDirectory,
  readFile,
  createDirectory,
  writeFile,
  copyFile,
  moveFile,
  renameFile,
  searchFiles,
  resolveSafePath
};

