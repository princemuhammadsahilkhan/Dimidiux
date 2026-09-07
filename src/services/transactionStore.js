import { resolveSafePath, readFile, listDirectory } from './filesystemTool.js';
import { fsConfig } from '../config/fsConfig.js';

const TX_STORAGE_KEY = 'evo_transactions';

export function computeFingerprint(content) {
  if (content === null || content === undefined) return 'fp_null_0';
  const str = typeof content === 'string' ? content : String(content);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `fp_${Math.abs(hash).toString(16)}_${str.length}`;
}

export function getTransactions() {
  try {
    const data = localStorage.getItem(TX_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to load transaction history:', e);
    return [];
  }
}

export function saveTransactions(transactions) {
  try {
    localStorage.setItem(TX_STORAGE_KEY, JSON.stringify(transactions));
  } catch (e) {
    console.error('Failed to save transaction history:', e);
  }
}

export function recordTransaction(txRecord) {
  const current = getTransactions();
  const updated = [txRecord, ...current];
  saveTransactions(updated);
  return txRecord;
}

export function getTransaction(transactionId) {
  const current = getTransactions();
  return current.find((t) => t.transactionId === transactionId) || null;
}

/**
 * Conservative State-Aware Rollback Execution
 */
export async function rollbackTransaction(transactionId, root = fsConfig.workspaceRoot) {
  const tx = getTransaction(transactionId);
  if (!tx) {
    return { success: false, error: `Transaction "${transactionId}" not found.` };
  }

  if (tx.rolledBack) {
    return { success: false, error: `Transaction "${transactionId}" has already been rolled back.` };
  }

  const { actionType, source, destination, targetPath, previousState, newState } = tx;

  // Node vs Browser FS check
  let fs = null;
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    fs = await import('fs');
  }

  try {
    if (actionType === 'create_directory') {
      const safeDir = resolveSafePath(targetPath, root);
      if (fs) {
        if (!fs.existsSync(safeDir)) {
          return { success: false, error: 'Rollback refused: Target directory no longer exists.' };
        }
        const contents = fs.readdirSync(safeDir);
        if (contents.length > 0) {
          return { success: false, error: 'Rollback refused: Directory is no longer empty.' };
        }
        fs.rmdirSync(safeDir);
      }
    } else if (actionType === 'write_file') {
      const safeFile = resolveSafePath(targetPath, root);
      if (fs) {
        if (!fs.existsSync(safeFile)) {
          if (previousState.existed) {
            return { success: false, error: 'Rollback refused: File previously existed but is now missing.' };
          }
        } else {
          const currentContent = fs.readFileSync(safeFile, 'utf-8');
          const currentFp = computeFingerprint(currentContent);
          if (currentFp !== newState.fingerprint) {
            return { success: false, error: 'Rollback refused: File content has been modified since transaction.' };
          }

          if (previousState.existed) {
            // Restore previous content
            fs.writeFileSync(safeFile, previousState.content, 'utf-8');
          } else {
            // Unlink newly created file
            fs.unlinkSync(safeFile);
          }
        }
      }
    } else if (actionType === 'copy_file') {
      const safeDest = resolveSafePath(destination, root);
      if (fs) {
        if (!fs.existsSync(safeDest)) {
          return { success: false, error: 'Rollback refused: Copied destination no longer exists.' };
        }
        const currentContent = fs.readFileSync(safeDest, 'utf-8');
        const currentFp = computeFingerprint(currentContent);
        if (currentFp !== newState.fingerprint) {
          return { success: false, error: 'Rollback refused: Copied file has been modified since transaction.' };
        }
        fs.unlinkSync(safeDest);
      }
    } else if (actionType === 'move_file') {
      const safeSrc = resolveSafePath(source, root);
      const safeDest = resolveSafePath(destination, root);
      if (fs) {
        if (!fs.existsSync(safeDest)) {
          return { success: false, error: 'Rollback refused: Moved destination no longer exists.' };
        }
        if (fs.existsSync(safeSrc)) {
          return { success: false, error: 'Rollback refused: Original source location is occupied by new file.' };
        }
        const currentContent = fs.readFileSync(safeDest, 'utf-8');
        const currentFp = computeFingerprint(currentContent);
        if (currentFp !== newState.fingerprint) {
          return { success: false, error: 'Rollback refused: Moved destination has been modified since transaction.' };
        }
        fs.renameSync(safeDest, safeSrc);
      }
    } else {
      return { success: false, error: `Rollback not supported for action type "${actionType}".` };
    }

    // Mark transaction as rolled back
    const transactions = getTransactions();
    const updated = transactions.map((t) => {
      if (t.transactionId === transactionId) {
        return { ...t, rolledBack: true, rolledBackAt: new Date().toISOString() };
      }
      return t;
    });
    saveTransactions(updated);

    return { success: true, transactionId, actionType };
  } catch (err) {
    return { success: false, error: `Rollback failed: ${err.message}` };
  }
}
