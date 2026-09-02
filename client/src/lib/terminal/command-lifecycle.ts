import { terminalService } from '@/lib/terminal-service';

const pendingInterrupts = new Map<string, Promise<void>>();

export type ManagedShellRuntime = 'posix' | 'powershell';

/** Resolve the same shell family used by the PTY execution strategy. */
export async function getManagedShellRuntime(): Promise<ManagedShellRuntime> {
  if (typeof window !== 'undefined' && window.electron?.platform === 'win32') {
    try {
      const result = await window.electron.getPlatformInfo();
      const info = result?.platformInfo || (result as any)?.info;
      return info?.wsl2Status === 'available' || info?.hasWSL2 === true
        ? 'posix'
        : 'powershell';
    } catch {
      // The backend falls back to native PowerShell when platform detection
      // fails, so use that same conservative choice here.
      return 'powershell';
    }
  }

  return 'posix';
}

/** Quote a value for the shell that will receive a terminal command. */
export function quoteShellArgument(value: string, runtime: ManagedShellRuntime): string {
  const normalized = String(value ?? '');
  if (runtime === 'powershell') {
    return `'${normalized.replace(/'/g, "''")}'`;
  }

  return `'${normalized.replace(/'/g, "'\\''")}'`;
}

/**
 * Format an executable path without changing ordinary command names. Native
 * PowerShell needs the call operator for a quoted path; POSIX shells only need
 * quoting when the configured path contains shell-significant characters.
 */
export function formatShellExecutable(value: string, runtime: ManagedShellRuntime): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';

  if (runtime === 'powershell') {
    if (/^[A-Za-z0-9._+/-]+$/.test(normalized)) return normalized;
    return `& ${quoteShellArgument(normalized, runtime)}`;
  }

  if (/^[A-Za-z0-9._/~+-]+$/.test(normalized)) return normalized;
  return quoteShellArgument(normalized, runtime);
}

/**
 * Build a command that reports its exit status without ending the reusable
 * shell. Listener, tunnel, and scanner controls all rely on this marker to
 * move their UI back to an idle/stopped state after a one-shot command exits.
 *
 * The PTY backend uses bash when WSL/POSIX execution is selected and
 * PowerShell when Windows is used as the native fallback. A POSIX-only
 * `export`/`printf` suffix silently failed in the latter case, leaving the UI
 * stuck in "running" after the command had already finished.
 */
export async function buildManagedShellCommand(command: string): Promise<string> {
  const normalized = String(command || '').trimEnd();
  if (!normalized) return '';

  const runtime = await getManagedShellRuntime();

  if (runtime === 'powershell') {
    // Reset the native exit-code slot so a prior command cannot contaminate a
    // cmdlet-only command, then prefer the real process exit code. `$?` still
    // catches PowerShell cmdlet/script failures where LASTEXITCODE is zero.
    return `$global:LASTEXITCODE = 0; ${normalized}; $osecboxExit = if ($LASTEXITCODE -is [int] -and $LASTEXITCODE -ne 0) { [int]$LASTEXITCODE } elseif ($?) { 0 } else { 1 }; [Console]::Write(([char]27 + ']9;osecbox-command-exit;' + $osecboxExit + [char]7))\n`;
  }

  return `${normalized}; printf '\\033]9;osecbox-command-exit;%s\\007' "$?"\n`;
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function stripAnsi(value: string): string {
  return value
    .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function outputEndsWithPrompt(output: string): boolean {
  const cleanOutput = stripAnsi(output).replace(/\r/g, '');
  const lines = cleanOutput.split('\n');
  const lastLine = lines[lines.length - 1]?.trimEnd() || '';

  if (!lastLine) return false;

  // Covers the custom bash prompt, common shell prompts, and PowerShell.
  return /(?:^|\s)(?:PS\s+[^>]+>|[^\s]+@[^\s:]+(?::[^$#>]*)?[$#>]\s*|[$#>]\s*)$/.test(lastLine);
}

async function waitForPrompt(terminalId: string, outputLengthBeforeInterrupt: number): Promise<boolean> {
  const deadline = Date.now() + 1500;

  // Give the PTY a chance to deliver ^C and the shell's replacement prompt.
  await delay(50);

  while (Date.now() < deadline) {
    const output = terminalService.getOutput(terminalId);
    const newOutput = output.slice(Math.min(outputLengthBeforeInterrupt, output.length));

    if (newOutput.length > 0 && outputEndsWithPrompt(newOutput)) {
      return true;
    }

    await delay(50);
  }

  return false;
}

/**
 * Wait for an earlier interrupt on a terminal before sending a new command.
 * This prevents a fast Stop -> Start click from sending the new command while
 * the old process is still unwinding.
 */
export function waitForTerminalInterrupt(terminalId: string): Promise<void> {
  return pendingInterrupts.get(terminalId) || Promise.resolve();
}

/** Wait until the shell has emitted its first prompt/output after creation. */
export async function waitForTerminalReady(terminalId: string, timeoutMs = 2000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let startSettled = await terminalService.waitForPTYStart(terminalId, timeoutMs);

  // Stop can arrive while WSL/history initialization is still in flight. The
  // canceled backend start leaves an inactive renderer PTY behind; recreate it
  // once so an immediate Stop -> Start does not require a third click.
  if (!startSettled) {
    const stalePTY = terminalService.getPTY(terminalId);
    if (stalePTY && !stalePTY.isActive && Date.now() < deadline) {
      terminalService.getOrCreatePTY(terminalId, stalePTY.sessionType);
      startSettled = await terminalService.waitForPTYStart(
        terminalId,
        Math.max(1, deadline - Date.now()),
      );
    }
  }

  if (!startSettled) return false;

  while (Date.now() < deadline) {
    // A WSL service failure can still produce bytes before the PTY exit event.
    // Require both a live PTY and a prompt-derived readiness signal; output
    // length alone sent commands into the already-dead process.
    if (terminalService.isPTYActive(terminalId) && terminalService.isPTYReady(terminalId)) {
      return true;
    }
    await delay(50);
  }

  return false;
}

/**
 * Interrupt the foreground command while keeping the interactive shell alive.
 * The shell then renders its normal prompt, allowing the same terminal to be
 * reused for another Start without creating a new PTY.
 */
export function interruptTerminalCommand(terminalId: string): Promise<void> {
  const previous = pendingInterrupts.get(terminalId) || Promise.resolve();
  const interrupt = previous
    .catch(() => undefined)
    .then(async () => {
      if (typeof window === 'undefined') return;

      // The global status bridge remains mounted while Foothold/Tunneling are
      // hidden. Mark the transition before writing Ctrl+C so late output from
      // the old command cannot resurrect its running state.
      window.dispatchEvent(new CustomEvent('listener-stop-requested', {
        detail: { listenerId: terminalId },
      }));

      try {
        if (
          !window.electron ||
          !terminalService.hasPTY(terminalId) ||
          !terminalService.isPTYActive(terminalId)
        ) return;

        terminalService.cancelPendingWrites(terminalId);
        const outputLengthBeforeInterrupt = terminalService.getOutput(terminalId).length;
        await window.electron.writeToListener({
            listenerId: terminalId,
            data: '\x03',
          });
        const promptReturned = await waitForPrompt(terminalId, outputLengthBeforeInterrupt);

        // A foreground tool that ignores Ctrl+C, or a WSL shell that stops
        // delivering output, must not be treated as a reusable live shell.
        // Force-stop the backend and let the next Start create/attach a fresh
        // PTY. The retained transcript remains intact and the status is
        // visible even though no real prompt can exist after a hard stop.
        if (!promptReturned) {
          const stopped = await terminalService.forceStopPTY(terminalId);
          if (stopped) {
            terminalService.writeExternalOutput(
              terminalId,
              '\r\n\x1b[33m^C stopped\x1b[0m\r\n[Shell stopped - press Start to reopen]\r\n',
              true,
            );
          }
        }
      } finally {
        window.dispatchEvent(new CustomEvent('listener-stopped', {
          detail: { listenerId: terminalId },
        }));
      }
    });

  pendingInterrupts.set(terminalId, interrupt);
  void interrupt.finally(() => {
    if (pendingInterrupts.get(terminalId) === interrupt) {
      pendingInterrupts.delete(terminalId);
    }
  }).catch(() => undefined);

  return interrupt;
}
