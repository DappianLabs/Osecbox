import { describe, expect, it } from 'vitest';
import { formatPwncatReadinessFailure } from '../electron/utils/tool-readiness';

describe('pwncat readiness diagnostics', () => {
  it('identifies the Python FileFinder incompatibility', () => {
    const message = formatPwncatReadinessFailure(
      "AttributeError: 'FileFinder' object has no attribute 'find_module'",
    );
    expect(message).toContain('incompatible with the current Python runtime');
    expect(message).toContain('Update/reinstall pwncat-cs');
  });

  it('preserves a bounded generic initialization failure', () => {
    const message = formatPwncatReadinessFailure('Traceback: package initialization failed');
    expect(message).toContain('failed its local initialization check');
    expect(message).toContain('package initialization failed');
  });
});
