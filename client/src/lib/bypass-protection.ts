/**
 * Bypass Protection System - OPTIMIZED
 * Prevents users from bypassing limits via console/localStorage
 */

import { isMonetizationEnabled } from './feature-flags';

class BypassProtection {
  private static instance: BypassProtection;
  private protectedKeys = ['osecbox-usage-stats', 'osecbox-sessions'];
  private isInitialized = false;

  static getInstance(): BypassProtection {
    if (!BypassProtection.instance) {
      BypassProtection.instance = new BypassProtection();
    }
    return BypassProtection.instance;
  }

  initialize() {
    if (this.isInitialized || !isMonetizationEnabled()) {
      return;
    }

    this.protectLocalStorage();
    this.protectSessionStorage();
    this.protectIndexedDB();
    this.protectConsoleAccess();
    this.isInitialized = true;
  }

  private protectLocalStorage() {
    const originalSetItem = localStorage.setItem.bind(localStorage);
    const originalRemoveItem = localStorage.removeItem.bind(localStorage);
    const originalClear = localStorage.clear.bind(localStorage);

    Object.defineProperty(localStorage, 'setItem', {
      value: (key: string, value: string) => {
        if (isMonetizationEnabled() && this.protectedKeys.some(k => key.includes(k))) {
          console.warn('[Security] Attempt to modify protected data blocked');
          return;
        }
        return originalSetItem(key, value);
      },
      writable: false,
      configurable: true
    });

    Object.defineProperty(localStorage, 'removeItem', {
      value: (key: string) => {
        if (isMonetizationEnabled() && this.protectedKeys.some(k => key.includes(k))) {
          console.warn('[Security] Attempt to remove protected data blocked');
          return;
        }
        return originalRemoveItem(key);
      },
      writable: false,
      configurable: true
    });

    Object.defineProperty(localStorage, 'clear', {
      value: () => {
        if (isMonetizationEnabled()) {
          console.warn('[Security] localStorage.clear() blocked to protect usage data');
          return;
        }
        return originalClear();
      },
      writable: false,
      configurable: true
    });
  }

  private protectSessionStorage() {
    const originalSetItem = sessionStorage.setItem.bind(sessionStorage);
    const originalRemoveItem = sessionStorage.removeItem.bind(sessionStorage);
    const originalClear = sessionStorage.clear.bind(sessionStorage);

    Object.defineProperty(sessionStorage, 'setItem', {
      value: (key: string, value: string) => {
        if (isMonetizationEnabled() && this.protectedKeys.some(k => key.includes(k))) {
          console.warn('[Security] Attempt to modify protected sessionStorage blocked');
          return;
        }
        return originalSetItem(key, value);
      },
      writable: false,
      configurable: true
    });

    Object.defineProperty(sessionStorage, 'removeItem', {
      value: (key: string) => {
        if (isMonetizationEnabled() && this.protectedKeys.some(k => key.includes(k))) {
          console.warn('[Security] Attempt to remove protected sessionStorage blocked');
          return;
        }
        return originalRemoveItem(key);
      },
      writable: false,
      configurable: true
    });

    Object.defineProperty(sessionStorage, 'clear', {
      value: () => {
        if (isMonetizationEnabled()) {
          console.warn('[Security] sessionStorage.clear() blocked to protect usage data');
          return;
        }
        return originalClear();
      },
      writable: false,
      configurable: true
    });
  }

  private protectIndexedDB() {
    if (!isMonetizationEnabled()) {
      return;
    }

    const originalOpen = indexedDB.open.bind(indexedDB);
    const originalDeleteDatabase = indexedDB.deleteDatabase.bind(indexedDB);

    Object.defineProperty(indexedDB, 'open', {
      value: (name: string, version?: number) => {
        if (this.protectedKeys.some(k => name.includes(k))) {
          console.warn('[Security] Attempt to open protected IndexedDB blocked');
          throw new DOMException('Access denied', 'SecurityError');
        }
        return originalOpen(name, version);
      },
      writable: false,
      configurable: true
    });

    Object.defineProperty(indexedDB, 'deleteDatabase', {
      value: (name: string) => {
        if (this.protectedKeys.some(k => name.includes(k))) {
          console.warn('[Security] Attempt to delete protected IndexedDB blocked');
          throw new DOMException('Access denied', 'SecurityError');
        }
        return originalDeleteDatabase(name);
      },
      writable: false,
      configurable: true
    });
  }

  private protectConsoleAccess() {
    if (!isMonetizationEnabled()) {
      return;
    }

    Object.defineProperty(window, 'ProFeatures', {
      get: () => {
        console.warn('[Security] Direct access to ProFeatures blocked');
        return undefined;
      },
      configurable: false
    });
  }
}

export const bypassProtection = BypassProtection.getInstance();
