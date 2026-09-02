import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface PrivilegeInfo {
  level: 'root' | 'sudo' | 'user' | 'admin' | 'unknown';
  isRoot: boolean;
  hasSudo: boolean;
  /** sudo exists in PATH; this does not mean a passwordless elevation is available. */
  sudoNoPassword: boolean;
  isAdmin: boolean;
  uid?: number;
  username?: string;
}

export class PrivilegeDetector {
  private cachedInfo: PrivilegeInfo | null = null;

  async detect(): Promise<PrivilegeInfo> {
    if (this.cachedInfo) {
      return this.cachedInfo;
    }

    if (process.platform === 'win32') {
      this.cachedInfo = await this.detectWindows();
    } else {
      this.cachedInfo = await this.detectUnix();
    }

    console.log('[PrivilegeDetector] Detected:', this.cachedInfo);
    return this.cachedInfo;
  }

  private async detectWindows(): Promise<PrivilegeInfo> {
    try {
      // Check if running as administrator
      // 'net session' requires admin privileges
      await execAsync('net session', { timeout: 2000 });
      
      return {
        level: 'admin',
        isRoot: false,
        hasSudo: false,
        sudoNoPassword: false,
        isAdmin: true,
        username: process.env.USERNAME || 'unknown',
      };
    } catch {
      return {
        level: 'user',
        isRoot: false,
        hasSudo: false,
        sudoNoPassword: false,
        isAdmin: false,
        username: process.env.USERNAME || 'unknown',
      };
    }
  }

  private async detectUnix(): Promise<PrivilegeInfo> {
    const uid = process.getuid ? process.getuid() : -1;
    const username = process.env.USER || process.env.USERNAME || 'unknown';

    // Check if root
    if (uid === 0) {
      return {
        level: 'root',
        isRoot: true,
        hasSudo: true,
        sudoNoPassword: true,
        isAdmin: true,
        uid,
        username,
      };
    }

    // Check if sudo available
    const sudoState = await this.checkSudo();

    return {
      level: sudoState.available ? 'sudo' : 'user',
      isRoot: false,
      hasSudo: sudoState.available,
      sudoNoPassword: sudoState.noPassword,
      // Having sudo installed is not the same as being root/admin. Keep this
      // false until an actual privileged state is detected; OsecBox never
      // attempts elevation as part of this read-only check.
      isAdmin: false,
      uid,
      username,
    };
  }

  private async checkSudo(): Promise<{ available: boolean; noPassword: boolean }> {
    try {
      // Check if sudo is available without password (cached credentials)
      execSync('sudo -n true', { 
        stdio: 'ignore', 
        timeout: 1000 
      });
      return { available: true, noPassword: true };
    } catch {
      // Check if sudo exists at all
      try {
        execSync('command -v sudo', {
          stdio: 'ignore', 
          timeout: 1000 
        });
        return { available: true, noPassword: false }; // Sudo exists but needs password
      } catch {
        return { available: false, noPassword: false }; // No sudo
      }
    }
  }

  clearCache() {
    this.cachedInfo = null;
  }
}

export const privilegeDetector = new PrivilegeDetector();
