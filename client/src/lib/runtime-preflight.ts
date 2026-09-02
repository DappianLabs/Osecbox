/**
 * Small, renderer-side adapters for checks that must happen before a
 * listener/tunnel is sent to the persistent PTY.  The checks are deliberately
 * supplied with probe functions so they remain deterministic and unit-testable.
 */

export interface ToolPreflightResponse {
  success: boolean;
  available?: boolean;
  usedWSL?: boolean;
  error?: string;
  role?: 'proxy' | 'agent' | 'unknown';
}

export interface PortPreflightResponse {
  success: boolean;
  available?: boolean;
  status?: 'available' | 'occupied' | 'permission-denied' | 'runtime-unavailable' | 'diagnostic-unavailable' | 'invalid';
  runtime?: string;
  verification?: 'bind' | 'occupancy-only';
  message?: string;
  error?: string;
}

export interface RuntimePreflightResult {
  ok: boolean;
  message?: string;
  warning?: string;
}

export async function preflightTool(
  toolName: string,
  probe: (args: { toolName: string; requiresLinux?: boolean }) => Promise<ToolPreflightResponse>,
  requiresLinux = true,
): Promise<RuntimePreflightResult> {
  const normalizedTool = toolName.trim();
  if (!normalizedTool) {
    return { ok: false, message: 'No executable was selected for this session.' };
  }

  try {
    const result = await probe({ toolName: normalizedTool, requiresLinux });
    if (!result?.success) {
      return {
        ok: false,
        message: result?.error || `The ${normalizedTool} runtime check could not be completed.`,
      };
    }

    if (!result.available) {
      const runtime = result.usedWSL
        ? 'the selected WSL2 Linux runtime'
        : requiresLinux
          ? 'the selected Linux runtime'
          : 'the selected runtime';
      return {
        ok: false,
        message: `${normalizedTool} is not available in ${runtime}. Install it in that runtime or choose another command.${result.error ? ` ${result.error}` : ''}`,
      };
    }

    return { ok: true };
  } catch (error: any) {
    return {
      ok: false,
      message: `${normalizedTool} runtime check failed: ${error?.message || String(error)}`,
    };
  }
}

export async function preflightPort(
  port: number,
  host: string,
  probe: (args: { port: number; host: string; requiresLinux?: boolean }) => Promise<PortPreflightResponse>,
  requiresLinux = true,
): Promise<RuntimePreflightResult> {
  try {
    const result = await probe({ port, host, requiresLinux });
    if (!result?.success) {
      return {
        ok: false,
        message: result?.error || `Port ${port} could not be checked in the selected runtime.`,
      };
    }

    if (!result.available || result.status === 'occupied' || result.status === 'permission-denied') {
      return {
        ok: false,
        message: result.message || `Port ${port} is not available in ${result.runtime || 'the selected runtime'}.`,
      };
    }

    if (result.status === 'runtime-unavailable' || result.status === 'diagnostic-unavailable' || result.status === 'invalid') {
      return {
        ok: false,
        message: result.message || `Port ${port} could not be verified in ${result.runtime || 'the selected runtime'}.`,
      };
    }

    return {
      ok: true,
      warning: result.verification === 'occupancy-only' ? result.message : undefined,
    };
  } catch (error: any) {
    return {
      ok: false,
      message: `Port ${port} preflight failed: ${error?.message || String(error)}`,
    };
  }
}

