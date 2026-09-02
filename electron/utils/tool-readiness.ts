/**
 * Turn known local tool-initialization failures into actionable diagnostics.
 * These checks never contact a target; they only describe a process that
 * failed before it could be used.
 */
export function formatPwncatReadinessFailure(output: string): string {
  const clean = String(output || '').replace(/\x00/g, '').replace(/\s+/g, ' ').trim();
  if (/FileFinder.*find_module|find_module.*FileFinder/i.test(clean)) {
    return 'pwncat-cs is installed but incompatible with the current Python runtime: it calls the removed FileFinder.find_module API. Update/reinstall pwncat-cs in WSL2, or run it from a virtual environment using a Python version supported by that pwncat release; OsecBox will not patch the system package automatically.';
  }

  const detail = clean.slice(0, 500);
  return `pwncat-cs is installed but failed its local initialization check${detail ? `: ${detail}` : '.'}`;
}
