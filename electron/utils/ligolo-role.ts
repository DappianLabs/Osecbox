export type LigoloRole = 'proxy' | 'agent' | 'unknown';

/** Classify a Ligolo-ng executable from local help output only. */
export function classifyLigoloRole(output: string): LigoloRole {
  const text = String(output || '');
  const hasProxyFlags = /(?:-selfcert|--selfcert|-laddr|--laddr)/i.test(text);
  const hasAgentFlags = /(?:-connect|--connect|-ignore-cert|--ignore-cert)/i.test(text);
  if (hasProxyFlags) return 'proxy';
  if (hasAgentFlags) return 'agent';
  return 'unknown';
}

