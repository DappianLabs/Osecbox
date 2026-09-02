import React from 'react';
import { X, Github, Terminal, Bot, Globe, Zap } from 'lucide-react';
import { createPortal } from 'react-dom';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  const [appVersion, setAppVersion] = React.useState('1.0.2');
  // Prevent body scroll when dialog is open
  React.useEffect(() => {
    if (window.electron?.getAppVersion) {
      void window.electron.getAppVersion().then(({ version }) => setAppVersion(version)).catch(() => undefined);
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  if (!open) return null;

  const dialogContent = (
    <>
      {/* Backdrop */}
      <div 
        className="ui-dialog-overlay fixed bg-black/80 backdrop-blur-sm"
        onClick={onClose}
        style={{ 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          right: 0, 
          bottom: 0,
          zIndex: 99999
        }}
      />
      
      {/* Dialog */}
      <div 
        className="fixed flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        style={{ 
          position: 'fixed', 
          top: 0, 
          left: 0, 
          right: 0, 
          bottom: 0,
          zIndex: 100000,
          pointerEvents: 'none'
        }}
      >
        <div 
          className="ui-popover-enter bg-background border border-border rounded-lg shadow-2xl w-[700px] max-w-[95vw] max-h-[85vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          style={{ pointerEvents: 'auto' }}
        >
          {/* Header */}
          <div className="bg-muted/30 p-6 border-b border-border relative">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close About OsecBox"
              className="absolute top-4 right-4 w-7 h-7 rounded hover:bg-accent flex items-center justify-center transition-colors text-muted-foreground hover:text-foreground"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 bg-muted rounded-lg flex items-center justify-center border border-border">
                <img src="./osecbox-icon.png" alt="OsecBox" width={48} height={48} draggable={false} className="w-12 h-12 rounded-xl object-cover shadow-[0_0_24px_rgba(139,92,246,0.4)]" />
              </div>
              <div>
              <h1 id="about-dialog-title" className="text-2xl font-bold text-foreground">OsecBox</h1>
                <p className="text-muted-foreground text-sm">Context-Aware Pentesting Platform</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(85vh-140px)]">
            {/* Description */}
            <div>
              <h2 className="text-lg font-bold text-foreground mb-2">What is OsecBox?</h2>
              <p className="text-base text-muted-foreground leading-relaxed mb-3">
                OsecBox is a comprehensive offensive security platform that brings together all your favorite pentesting 
                tools into one unified interface. No more switching between terminals and tools - everything you need is 
                right here with intelligent AI assistance guiding you through your security assessments.
              </p>
              <p className="text-base text-muted-foreground leading-relaxed">
                Built for penetration testers, bug bounty hunters, and security researchers who want to work faster and 
                smarter. OsecBox tracks your entire attack chain, remembers context across sessions, and suggests next 
                steps based on your findings.
              </p>
            </div>

            {/* Features */}
            <div>
              <h2 className="text-lg font-bold text-foreground mb-3">Key Features</h2>
              <div className="space-y-2.5">
                <div className="bg-muted/30 rounded border border-border p-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Terminal className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-base text-foreground">Integrated Pentesting Tools</span>
                  </div>
                  <p className="text-base text-muted-foreground leading-relaxed">
                    Nmap for network scanning, Metasploit for exploitation, Subfinder & Amass for subdomain enumeration, 
                    Nikto & Nuclei for vulnerability scanning, DirBuster for directory brute-forcing, and many more tools 
                    all working together seamlessly.
                  </p>
                </div>
                
                <div className="bg-muted/30 rounded border border-border p-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Bot className="w-4 h-4 text-purple-500" />
                    <span className="font-semibold text-base text-foreground">Context-Aware AI Assistant</span>
                  </div>
                  <p className="text-base text-muted-foreground leading-relaxed">
                    Powered by Groq AI, the assistant tracks your entire pentest session - every host discovered, every 
                    foothold gained, every credential found. It understands your attack chain and suggests intelligent 
                    next steps. Never lose context or forget what you've tried.
                  </p>
                </div>
                
                <div className="bg-muted/30 rounded border border-border p-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Globe className="w-4 h-4 text-blue-500" />
                    <span className="font-semibold text-base text-foreground">Cross-Platform Support</span>
                  </div>
                  <p className="text-base text-muted-foreground leading-relaxed">
                    Works on Windows (via WSL2), native Linux, and Kali Linux. Automatic tool detection and WSL2 
                    integration means you can run Linux pentesting tools on Windows without any manual configuration.
                  </p>
                </div>
                
                <div className="bg-muted/30 rounded border border-border p-3.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Zap className="w-4 h-4 text-yellow-500" />
                    <span className="font-semibold text-base text-foreground">Real-Time Interactive Terminals</span>
                  </div>
                  <p className="text-base text-muted-foreground leading-relaxed">
                    Full-featured terminals with live output streaming, command history, and interactive shells. 
                    Run custom commands, chain tools together, and see results in real-time. All terminals are 
                    persistent across sessions.
                  </p>
                </div>
              </div>
            </div>

            {/* Tech Stack */}
            <div>
              <h2 className="text-lg font-bold text-foreground mb-2">Built With</h2>
              <div className="flex flex-wrap gap-2">
                {['Electron', 'React', 'TypeScript', 'Tailwind CSS', 'Groq AI', 'Node.js', 'xterm.js'].map((tech) => (
                  <span 
                    key={tech}
                    className="px-3 py-1.5 bg-muted text-muted-foreground rounded text-sm font-mono border border-border"
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </div>

            {/* Links */}
            <div className="pt-3 border-t border-border">
              <a
                href="https://github.com/DappianLabs/Osecbox"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-4 bg-muted/50 rounded border border-border hover:bg-muted transition-all group"
              >
                <Github className="w-6 h-6 text-muted-foreground group-hover:text-foreground transition-colors" />
                <div className="flex-1">
                  <div className="font-semibold text-foreground text-base">View on GitHub</div>
                  <div className="text-muted-foreground text-sm">Star the project • Report issues • Contribute code</div>
                </div>
                <span className="text-muted-foreground group-hover:text-foreground transition-colors text-lg">→</span>
              </a>
            </div>

            {/* Footer */}
            <div className="text-center pt-3 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Made for the offensive security community
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                v{appVersion} • © 2024 OsecBox
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  // Render in portal to ensure it's above everything
  return createPortal(dialogContent, document.body);
}
