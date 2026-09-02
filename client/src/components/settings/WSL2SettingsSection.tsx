import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Terminal, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { WSL2StatusBadge } from '@/components/platform/WSL2StatusBadge';

interface DnsCheckState {
  status: string;
  ok: boolean;
  runtime?: string;
  target?: string;
  nameservers?: string[];
  message: string;
  remediation?: string[];
}

interface WSL2SettingsSectionProps {
  settings: any;
  updateSetting: (key: string, value: any) => void | Promise<void>;
}

export function WSL2SettingsSection({ settings, updateSetting }: WSL2SettingsSectionProps) {
  const [dnsTarget, setDnsTarget] = useState('');
  const [dnsChecking, setDnsChecking] = useState(false);
  const [dnsCheck, setDnsCheck] = useState<DnsCheckState | null>(null);
  const [distroDraft, setDistroDraft] = useState(String(settings.wsl2Distro || ''));
  const [userDraft, setUserDraft] = useState(String(settings.wsl2User || ''));
  const [extraPathsDraft, setExtraPathsDraft] = useState((settings.wsl2ExtraPaths || []).join(':'));
  const pendingWrites = useRef<Set<Promise<void>>>(new Set());
  const dnsRequestGeneration = useRef(0);

  useEffect(() => {
    setDistroDraft(String(settings.wsl2Distro || ''));
  }, [settings.wsl2Distro]);

  useEffect(() => {
    setUserDraft(String(settings.wsl2User || ''));
  }, [settings.wsl2User]);

  useEffect(() => {
    setExtraPathsDraft((settings.wsl2ExtraPaths || []).join(':'));
  }, [settings.wsl2ExtraPaths]);

  useEffect(() => () => {
    dnsRequestGeneration.current += 1;
  }, []);

  const commitSetting = (key: string, value: any) => {
    const pending = Promise.resolve(updateSetting(key, value));
    pendingWrites.current.add(pending);
    void pending.then(
      () => pendingWrites.current.delete(pending),
      () => pendingWrites.current.delete(pending),
    );
    return pending;
  };

  const handleDnsCheck = async () => {
    const requestId = ++dnsRequestGeneration.current;
    const target = dnsTarget.trim() || undefined;
    setDnsChecking(true);
    setDnsCheck(null);
    try {
      // Blur commits are asynchronous. Wait for all writes already triggered by
      // this form before asking the backend to diagnose its active runtime.
      await Promise.allSettled(Array.from(pendingWrites.current));
      if (requestId !== dnsRequestGeneration.current) return;

      const result = await window.electron?.diagnoseDns({ target });
      if (requestId !== dnsRequestGeneration.current) return;

      if (!result?.success || !result.diagnostic) {
        setDnsCheck({
          status: 'diagnostic-unavailable',
          ok: false,
          message: result?.error || result?.message || 'The Electron DNS diagnostic returned no details.',
          remediation: [
            'Confirm that OsecBox is running as the packaged Electron app, then retry.',
            'If the problem persists, inspect the selected WSL2 distro/runtime and run scripts/setup/check-dns.bat.',
          ],
        });
        return;
      }

      setDnsCheck(result.diagnostic);
    } catch (error: any) {
      if (requestId !== dnsRequestGeneration.current) return;
      setDnsCheck({
        status: 'diagnostic-unavailable',
        ok: false,
        message: error?.message || 'The DNS diagnostic could not be invoked.',
        remediation: [
          'Restart OsecBox and retry the preflight.',
          'If the Electron bridge is unavailable, run scripts/setup/check-dns.bat from PowerShell.',
        ],
      });
    } finally {
      if (requestId === dnsRequestGeneration.current) {
        setDnsChecking(false);
      }
    }
  };

  return (
    <section id="settings-wsl2" className="mb-8 scroll-mt-8">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b-2 border-cyan-500/30">
        <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
          <Terminal className="w-5 h-5 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">Platform & WSL2</h2>
          <p className="text-xs text-muted-foreground">Windows Subsystem for Linux detection and configuration</p>
        </div>
      </div>
      <div className="win7-panel p-6 space-y-4 bg-card/50 border-2 border-border/80 shadow-xl rounded-xl">
        <WSL2StatusBadge />

        {/* Runtime DNS preflight */}
        <div className="space-y-3 bg-emerald-500/5 p-4 rounded-lg border-2 border-emerald-500/30 shadow-sm">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-foreground">DNS preflight</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Run a read-only lookup in the same WSL2/Linux runtime used by OsecBox tools. Leave the target blank to test a neutral public name, or enter a hostname to distinguish a local resolver problem from a target-specific record/VPN problem.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id="dnsPreflightTarget"
              value={dnsTarget}
              onChange={(e) => setDnsTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleDnsCheck(); }}
              className="font-mono bg-background/50 border-2 border-border/60 text-foreground placeholder:text-muted-foreground focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 hover:border-border transition-all rounded-lg shadow-sm"
              placeholder="Optional hostname, e.g. example.com"
              aria-label="Optional DNS preflight hostname"
            />
            <Button
              type="button"
              variant="outline"
              loading={dnsChecking}
              loadingLabel="Checking DNS..."
              onClick={() => void handleDnsCheck()}
              className="sm:min-w-36"
            >
              Check DNS
            </Button>
          </div>
          {dnsCheck && (
            <div
              role="status"
              className={`rounded-md border-2 p-3 text-xs ${dnsCheck.ok ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}
            >
              <p className="flex items-start gap-2 font-semibold text-foreground">
                {dnsCheck.ok
                  ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
                  : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />}
                <span>{dnsCheck.status}: {dnsCheck.message}</span>
              </p>
              {dnsCheck.runtime && (
                <p className="mt-2 text-muted-foreground">Runtime: <code className="font-mono">{dnsCheck.runtime}</code></p>
              )}
              {dnsCheck.nameservers && dnsCheck.nameservers.length > 0 && (
                <p className="mt-1 text-muted-foreground">Nameservers: <code className="font-mono">{dnsCheck.nameservers.join(', ')}</code></p>
              )}
              {!dnsCheck.ok && dnsCheck.remediation && dnsCheck.remediation.length > 0 && (
                <div className="mt-2 text-muted-foreground">
                  <p className="font-semibold text-foreground">How to solve it:</p>
                  <ul className="list-disc ml-4 mt-1 space-y-1">
                    {dnsCheck.remediation.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* WSL2 Custom Configuration */}
        <div className="space-y-4 bg-cyan-500/5 p-4 rounded-lg border-2 border-cyan-500/30 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-foreground">WSL2 Custom Configuration</h3>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="wsl2Distro" className="text-foreground font-semibold">WSL2 Distribution</Label>
            <Input
              id="wsl2Distro"
              value={distroDraft}
              onChange={(e) => setDistroDraft(e.target.value)}
              onBlur={() => void commitSetting('wsl2Distro', distroDraft.trim())}
              className="font-mono bg-background/50 border-2 border-border/60 text-foreground placeholder:text-muted-foreground focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 hover:border-border transition-all rounded-lg shadow-sm"
              placeholder="Ubuntu (leave empty for default)"
            />
            <p className="text-xs text-muted-foreground">
              Specify which WSL2 distro to use. Leave empty to use default distro. 
              Run <code className="bg-background px-1.5 py-0.5 rounded font-mono text-xs">wsl --list</code> to see available distros.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wsl2User" className="text-foreground font-semibold">WSL2 User</Label>
            <Input
              id="wsl2User"
              value={userDraft}
              onChange={(e) => setUserDraft(e.target.value)}
              onBlur={() => void commitSetting('wsl2User', userDraft.trim())}
              className="font-mono bg-background/50 border-2 border-border/60 text-foreground placeholder:text-muted-foreground focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 hover:border-border transition-all rounded-lg shadow-sm"
              placeholder="kali (leave empty for default)"
            />
            <p className="text-xs text-muted-foreground">
              Specify which user to run commands as. Leave empty to use default user. 
              Useful if tools are installed in a specific user's home directory (e.g., <code className="bg-background px-1.5 py-0.5 rounded font-mono text-xs">/home/kali/go/bin/</code>).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wsl2ExtraPaths" className="text-foreground font-semibold">Extra Tool Paths</Label>
            <Input
              id="wsl2ExtraPaths"
              value={extraPathsDraft}
              onChange={(e) => setExtraPathsDraft(e.target.value)}
              onBlur={() => {
                const paths = extraPathsDraft.split(':').map((path: string) => path.trim()).filter(Boolean);
                void commitSetting('wsl2ExtraPaths', paths);
              }}
              className="font-mono bg-background/50 border-2 border-border/60 text-foreground placeholder:text-muted-foreground focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20 hover:border-border transition-all rounded-lg shadow-sm"
              placeholder="/home/kali/tools:/opt/custom/bin"
            />
            <p className="text-xs text-muted-foreground">
              Add custom directories where your tools are installed. Separate multiple paths with <code className="bg-background px-1 py-0.5 rounded font-mono text-xs">:</code>
            </p>
            <div className="bg-amber-500/10 border-2 border-amber-500/30 rounded-md p-2.5 mt-2">
              <p className="text-xs text-foreground font-semibold mb-1">💡 Tool not found?</p>
              <p className="text-xs text-muted-foreground">
                If a tool shows "not found" error, add its directory here. 
                Example: If subfinder is at <code className="bg-background px-1 py-0.5 rounded font-mono text-xs">/home/kali/go/bin/subfinder</code>, 
                add <code className="bg-background px-1 py-0.5 rounded font-mono text-xs">/home/kali/go/bin</code>
              </p>
            </div>
          </div>

          <div className="bg-cyan-500/10 border-2 border-cyan-500/40 rounded-lg p-3 shadow-sm">
            <p className="text-xs text-foreground font-semibold mb-1.5">💡 When to use custom settings:</p>
            <ul className="text-xs text-muted-foreground space-y-1 ml-4 list-disc">
              <li>Tools installed in non-default user (e.g., kali user instead of default Ubuntu user)</li>
              <li>Multiple WSL2 distros and want to use a specific one</li>
              <li>Custom tool paths like <code className="bg-background px-1 py-0.5 rounded font-mono">/home/kali/tools</code></li>
              <li>Tools not found in standard locations</li>
            </ul>
          </div>
        </div>
        
        <div className="text-xs text-muted-foreground space-y-2 bg-muted/30 p-4 rounded-lg border-2 border-border/60 shadow-sm">
          <p className="font-semibold text-foreground">About WSL2:</p>
          <p>Most pentesting tools (nmap, metasploit, nikto, etc.) require Linux. On Windows, OsecBox automatically uses WSL2 when available.</p>
          <p className="font-semibold text-foreground mt-3">If WSL2 is not detected:</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Open PowerShell as Administrator</li>
            <li>Run: <code className="bg-background px-2 py-0.5 rounded font-mono text-xs">wsl --install</code></li>
            <li>Restart your computer</li>
            <li>Restart OsecBox</li>
          </ol>
          <p className="mt-3">
            <a href="https://learn.microsoft.com/en-us/windows/wsl/install" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline font-semibold">
              Official WSL2 Installation Guide →
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
