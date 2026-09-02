import type { ScannerType } from './scanner-types';

export function getScannerHistoryStorageKey(scannerType: ScannerType): string {
  switch (scannerType) {
    case 'universal':
      return 'universal-history';
    case 'dirbuster':
      return 'dirbuster-history';
    default:
      return scannerType + '-history';
  }
}

export function scannerUsesLocalHistory(scannerType: ScannerType): boolean {
  return scannerType === 'universal' || scannerType === 'dirbuster';
}

