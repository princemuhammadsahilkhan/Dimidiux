/**
 * Step 10: Limited System Tools & Constrained Command Execution
 * Implements safe, allowlisted system capabilities (time, system info, constrained command runner).
 */

export const ALLOWED_COMMANDS = ['echo', 'date', 'node', 'pwd'];

export class SystemToolService {
  /**
   * Returns current time and timezone metadata
   */
  getTime() {
    const now = new Date();
    const isoStr = now.toISOString();
    return {
      success: true,
      iso: isoStr,
      isoString: isoStr,
      local: now.toString(),
      timestamp: now.getTime(),
      timezoneOffsetMinutes: now.getTimezoneOffset()
    };
  }

  /**
   * Returns safe system information
   */
  getSystemInfo() {
    return {
      success: true,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsage: process.memoryUsage ? process.memoryUsage() : null
    };
  }

  /**
   * Executes a constrained, allowlisted command safely
   */
  async runConstrainedCommand(command, args = [], options = {}) {
    if (!command || typeof command !== 'string') {
      return { success: false, error: 'Command must be a non-empty string.', exitCode: 1 };
    }

    const trimmedCmd = command.trim().toLowerCase();
    if (!ALLOWED_COMMANDS.includes(trimmedCmd)) {
      return {
        success: false,
        error: `Security Violation: Command '${command}' is not in the allowed command list (${ALLOWED_COMMANDS.join(', ')}). Arbitrary shell execution is prohibited.`,
        exitCode: 126
      };
    }

    // Input sanitization & dangerous token checks
    const fullCommandLine = `${command} ${args.join(' ')}`;
    const dangerousTokens = [';', '&&', '||', '|', '`', '$', '>', '<', 'sudo', 'rm', 'chmod', 'chown', 'curl', 'wget', 'bash', 'sh'];
    for (const token of dangerousTokens) {
      if (args.some((arg) => String(arg).includes(token))) {
        return {
          success: false,
          error: `Security Violation: Dangerous token '${token}' detected in command arguments. Arg injection prohibited.`,
          exitCode: 127
        };
      }
    }

    const timeoutMs = typeof options.timeoutMs === 'number' ? Math.min(options.timeoutMs, 10000) : 5000;
    const startMs = Date.now();

    try {
      const cp = await import('child_process');
      const execSync = cp.execSync || cp.default?.execSync;
      const output = execSync(`${trimmedCmd} ${args.join(' ')}`, {
        timeout: timeoutMs,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const endMs = Date.now();
      const outStr = (output || '').trim();
      return {
        success: true,
        command: trimmedCmd,
        args,
        output: outStr,
        stdout: outStr,
        exitCode: 0,
        durationMs: endMs - startMs
      };
    } catch (err) {
      const endMs = Date.now();
      return {
        success: false,
        command: trimmedCmd,
        args,
        output: (err.stdout || '').toString().trim(),
        error: (err.stderr || err.message || 'Execution error').toString().trim(),
        exitCode: err.status || 1,
        durationMs: endMs - startMs
      };
    }
  }
}

export const systemToolService = new SystemToolService();
export const systemTool = systemToolService;
export default systemToolService;
