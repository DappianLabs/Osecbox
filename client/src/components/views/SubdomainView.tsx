import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Globe, Download, Trash2, CheckSquare, Square, Grid3x3, List, Layers, AlertCircle } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { SmoothResizable } from '@/components/ui/smooth-resizable';
import { useScanner } from '@/lib/scanner-context';
import { useToast } from '@/components/ui/toast';
import { useNavigationStore } from '@/lib/navigation-store';
import { usePlatform } from '@/hooks/usePlatform';
import { WSL2StatusBadge } from '@/components/platform/WSL2StatusBadge';
import { WSL2SetupDialog } from '@/components/platform/WSL2SetupDialog';
import { useSubdomainStore } from '@/lib/subdomain-store';
import { useErrorStore } from '@/lib/error-store';
import { ViewErrorBoundary } from '@/components/ui/ViewErrorBoundary';
import { usePanelLayoutStore } from '@/lib/panel-layout-store';
import { ViewWithSidebar } from '@/components/layout/ViewWithSidebar';
import { TabBar } from '@/components/nmap/TabBar';
import { SubdomainToolSelector } from '@/components/subdomain/SubdomainToolSelector';
import { SubdomainInputSection } from '@/components/subdomain/SubdomainInputSection';
import { SubdomainFilterBar } from '@/components/subdomain/SubdomainFilterBar';
import { SubdomainStatsBar } from '@/components/subdomain/SubdomainStatsBar';
import { SubdomainContextMenu } from '@/components/subdomain/SubdomainContextMenu';
import { SubdomainResultsGrid } from '@/components/subdomain/SubdomainResultsGrid';
import { SubdomainTerminalPanel } from '@/components/subdomain/SubdomainTerminalPanel';
import { terminalService } from '@/lib/terminal-service';
import { waitForTerminalReady } from '@/lib/terminal/command-lifecycle';
import { cleanupTerminalSession } from '@/lib/session-cleanup';

interface Subdomain {
  subdomain: string;
  ip: string;
  status: 'active' | 'inactive' | 'unknown';
  ports?: string;
}

interface ToolSession {
  toolId: string;
  toolName: string;
  domain: string;
  timestamp: number;
  subdomains: Subdomain[];
  isActive: boolean;
  customFlags?: string; // Custom command-line flags
}

type ViewDensity = 'compact' | 'comfortable' | 'line';
type SortField = 'subdomain' | 'ip' | 'status' | 'ports';
type SortOrder = 'asc' | 'desc';

function createSubdomainSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function SubdomainView({ isActive = true }: { isActive?: boolean }) {
  const navigateToSettings = useNavigationStore((state) => state.navigateToSettings);
  const { showToast } = useToast();
  const { platformInfo, refresh: refreshPlatform } = usePlatform();
  const addError = useErrorStore((state) => state.addError);
  
  // UNIFIED PERSISTENCE: Use single store for all panel layouts
  const { getPanelSize, saveLayout } = usePanelLayoutStore();
  
  // FIX: Get addTab from scanner context for "Send to Scan" functionality
  const { addTab: addScanTab } = useScanner();
  
  // Keep the most recent domain/results in the shared persisted store as a
  // reload-safe fallback. The live UI remains per-session so switching tabs
  // never replaces another session's results.
  const {
    domain: storedDomain,
    subdomains: storedSubdomains,
    setDomain: setStoredDomain,
    setSubdomains: setStoredSubdomains,
  } = useSubdomainStore();
  
  // Tab-based tool sessions (each tab = one tool run) - INDEPENDENT TABS
  const [toolSessions, setToolSessions] = useState<ToolSession[]>([
    {
      toolId: createSubdomainSessionId(),
      toolName: 'New Session',
      domain: storedDomain,
      timestamp: Date.now(),
      subdomains: storedSubdomains,
      isActive: false,
    }
  ]);
  const toolSessionsRef = useRef<ToolSession[]>(toolSessions);
  toolSessionsRef.current = toolSessions;
  const [activeSessionId, setActiveSessionId] = useState<string>(toolSessions[0].toolId);
  
  // Each tab has its own selected tool and domain
  // Don't use shared state - each tab is independent
  const [tabStates, setTabStates] = useState<Record<string, {
    selectedTool: string | null;
    domain: string;
  }>>({
    [toolSessions[0].toolId]: {
      selectedTool: null,
      domain: storedDomain,
    }
  });

  // One process id per session prevents a canceled run from racing a restart
  // in the same tab. The id is intentionally separate from the terminal id so
  // late output from an old process can be ignored safely.
  const activeSubdomainRunsRef = useRef<Map<string, string>>(new Map());
  const pendingSubdomainStopsRef = useRef<Map<string, Promise<void>>>(new Map());

  const isCurrentSubdomainRun = useCallback((sessionId: string, processId: string) => {
    return activeSubdomainRunsRef.current.get(sessionId) === processId;
  }, []);

  const recordSubdomainEvidence = useCallback(async (
    sessionId: string,
    target: string,
    tool: string,
    output: string,
    parsedResults: any[] = [],
    attackSessionId?: string,
    runId?: string,
  ) => {
    if (!output || !output.trim() || !attackSessionId) return;

    try {
      const { useAttackState } = await import('@/lib/attack-state-store');
      const attackState = useAttackState.getState();
      if (attackState.session?.id !== attackSessionId) return;
      await attackState.processScannerResults(target, {
        scannerType: 'subdomain',
        results: parsedResults,
        command: `${tool} ${target}`.trim(),
        output,
        timestamp: Date.now(),
        target,
        tabId: sessionId,
        terminalId: sessionId,
        sessionId: attackSessionId,
        runId,
        tool,
      });
    } catch (error) {
      // AI enrichment must never change the tool's visible success/failure
      // state or block the terminal lifecycle.
      console.warn('[SubdomainView] Failed to record AI evidence:', error);
    }
  }, []);

  const cancelSubdomainSession = useCallback(async (sessionId: string, notify = false) => {
    const processId = activeSubdomainRunsRef.current.get(sessionId);
    activeSubdomainRunsRef.current.delete(sessionId);

    // Render the same terminal lifecycle as the shell-backed scanner/tunnel:
    // cancellation is visible and leaves a prompt-ready session behind. The
    // global ToolOutputCapture owns streamed AI evidence, so do not submit the
    // same partial transcript here a second time.
    if (processId) {
      // Remove the route before asking Electron to stop the child. This makes
      // late chunks from the canceled process harmless, including when a new
      // run is started immediately in the same session.
      terminalService.unregisterExternalOutputRoute(processId);
      terminalService.writeExternalOutput(
        sessionId,
        '\r\n\x1b[33m^C Scan stopped\x1b[0m\r\n$ ',
        true,
      );
    }

    setToolSessions(prev => prev.map(session =>
      session.toolId === sessionId ? { ...session, isActive: false } : session
    ));

    if (processId && window.electron) {
      const stopPromise = Promise.resolve()
        .then(() => window.electron!.cancelTool(processId))
        .then(() => undefined)
        .catch((error) => {
          console.error('[SubdomainView] Failed to cancel tool:', error);
        });
      pendingSubdomainStopsRef.current.set(sessionId, stopPromise);
      await stopPromise;
      if (pendingSubdomainStopsRef.current.get(sessionId) === stopPromise) {
        pendingSubdomainStopsRef.current.delete(sessionId);
      }
    }

    if (notify) {
      showToast('Scan cancelled', 'info');
    }
  }, [showToast]);

  // Register tab system with TabBar
  useEffect(() => {
    if (!isActive) return;

    const event = new CustomEvent('subdomain-register-tabs', {
      detail: {
        tabs: toolSessions.map(s => ({
          id: s.toolId,
          title: s.toolName,
          isScanning: s.isActive,
        })),
        activeTabId: activeSessionId,
        onAddTab: () => {
          const newSession: ToolSession = {
            toolId: createSubdomainSessionId(),
            toolName: 'New Session',
            domain: '',
            timestamp: Date.now(),
            subdomains: [],
            isActive: false,
          };
          setToolSessions(prev => [...prev, newSession]);
          setActiveSessionId(newSession.toolId);
          
          // Create fresh state for new tab
          setTabStates(prev => ({
            ...prev,
            [newSession.toolId]: {
              selectedTool: null,
              domain: '',
            }
          }));
          
          showToast('New tab created', 'info');
        },
        onCloseTab: (tabId: string) => {
          void cancelSubdomainSession(tabId);
          cleanupTerminalSession(tabId);

          const remaining = toolSessions.filter(s => s.toolId !== tabId);
          const replacement = remaining.length > 0 ? null : {
            toolId: createSubdomainSessionId(),
            toolName: 'New Session',
            domain: '',
            timestamp: Date.now(),
            subdomains: [],
            isActive: false,
          };

          setToolSessions(replacement ? [replacement] : remaining);
          setTabStates(prev => {
            const next = { ...prev };
            delete next[tabId];
            if (replacement) {
              next[replacement.toolId] = { selectedTool: null, domain: '' };
            }
            return next;
          });

          if (activeSessionId === tabId) {
            setActiveSessionId(replacement?.toolId || remaining[remaining.length - 1].toolId);
          }
        },
        onSwitchTab: (tabId: string) => {
          setActiveSessionId(tabId);
          // Don't sync state when switching - each tab is independent
        },
      }
    });
    window.dispatchEvent(event);
  }, [isActive, toolSessions, activeSessionId, showToast, cancelSubdomainSession]);
  
  // Core state (now per-session)
  const [showWSL2Dialog, setShowWSL2Dialog] = useState(false);
  
  // Get active session
  const activeSession = toolSessions.find(s => s.toolId === activeSessionId);
  
  // Get state for active tab (each tab is independent)
  const activeTabState = tabStates[activeSessionId] || { selectedTool: null, domain: '' };
  const selectedTool = activeTabState.selectedTool;
  const domain = activeTabState.domain;
  
  // Update domain for active tab only
  const setDomain = useCallback((newDomain: string) => {
    setTabStates(prev => ({
      ...prev,
      [activeSessionId]: {
        ...prev[activeSessionId],
        domain: newDomain,
      }
    }));
  }, [activeSessionId]);
  
  // Update selected tool for active tab only
  const setSelectedTool = useCallback((toolId: string | null) => {
    setTabStates(prev => ({
      ...prev,
      [activeSessionId]: {
        ...prev[activeSessionId],
        selectedTool: toolId,
      }
    }));
  }, [activeSessionId]);
  
  // FIX: Use active session's subdomains, not global store
  // This ensures each tab shows its own results
  const subdomains = activeSession?.subdomains || [];
  
  // Scanning is stored on each session so switching tabs does not move the
  // spinner/cancel action to another session.
  const isScanning = activeSession?.isActive ?? false;
  
  // Platform detection is shared by the hook and the title bar. Avoid a forced
  // duplicate WSL2 subprocess lookup when this view is hidden.
  useEffect(() => {
    if (isActive && platformInfo?.wsl2Status === 'checking') {
      refreshPlatform();
    }
  }, [isActive, platformInfo?.wsl2Status, refreshPlatform]);
  
  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [viewDensity, setViewDensity] = useState<ViewDensity>('line'); // DEFAULT: List view
  const [sortField, setSortField] = useState<SortField>('subdomain');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [selectedSubdomains, setSelectedSubdomains] = useState<Set<string>>(new Set());
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'unknown'>('all');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; subdomain: Subdomain } | null>(null);
  const [toolContextMenu, setToolContextMenu] = useState<{ x: number; y: number; toolId: string } | null>(null);
  const [showRightClickHint, setShowRightClickHint] = useState(true);
  const [isInputCollapsed, setIsInputCollapsed] = useState(false);
  const [isTerminalResizing, setIsTerminalResizing] = useState(false);
  const handleTerminalResizeStart = useCallback(() => setIsTerminalResizing(true), []);
  const handleTerminalResizeEnd = useCallback((bottomHeight: number) => {
    setIsTerminalResizing(false);
    // Commit geometry only after the drag. The terminal output remains owned
    // by terminalService/history and is never coupled to panel remounts.
    saveLayout('subdomain-vertical-layout', 'terminal-panel', bottomHeight);
  }, [saveLayout]);
  const [selectedSubdomain, setSelectedSubdomain] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlatformReady, setIsPlatformReady] = useState(true); // Start as ready, check in background
  
  // Platform detection in background, don't block UI
  useEffect(() => {
    // Set ready immediately, platform check happens in background
    setIsPlatformReady(true);
    
    // Check platform status in background
    if (platformInfo && platformInfo.wsl2Status === 'checking') {
      // Still checking, but don't block UI
      console.log('[SubdomainView] Platform check in progress...');
    }
  }, [platformInfo]);
  
  // Refs
  const focusedCardIndex = useRef<number>(-1);

  // The TabBar reset action lives outside this view, so keep one small bridge
  // that resets the visible local sessions as well as the persisted fallback.
  const resetSubdomainSection = useCallback(() => {
    const sessions = toolSessionsRef.current;
    const firstSession = sessions[0] || {
      toolId: createSubdomainSessionId(),
      toolName: 'New Session',
      domain: '',
      timestamp: Date.now(),
      subdomains: [],
      isActive: false,
    };

    void Promise.all(sessions.map(session => cancelSubdomainSession(session.toolId))).then(() => {
      sessions.slice(1).forEach(session => cleanupTerminalSession(session.toolId));
      terminalService.clearOutput(firstSession.toolId);

      const resetSession: ToolSession = {
        toolId: firstSession.toolId,
        toolName: 'New Session',
        domain: '',
        timestamp: Date.now(),
        subdomains: [],
        isActive: false,
      };
      setToolSessions([resetSession]);
      setActiveSessionId(resetSession.toolId);
      setTabStates({
        [resetSession.toolId]: {
          selectedTool: null,
          domain: '',
        },
      });
      setStoredDomain('');
      setStoredSubdomains([]);
      setSelectedSubdomains(new Set());
      setSelectedSubdomain(null);
      setSearchQuery('');
      setStatusFilter('all');
      setBulkSelectMode(false);
      setError(null);
      setContextMenu(null);
      setToolContextMenu(null);
      showToast('Subdomain section reset', 'info');
    });
  }, [cancelSubdomainSession, setStoredDomain, setStoredSubdomains, showToast]);

  useEffect(() => {
    if (!isActive) return;
    const handleReset = () => resetSubdomainSection();
    window.addEventListener('subdomain-reset-section', handleReset);
    return () => window.removeEventListener('subdomain-reset-section', handleReset);
  }, [isActive, resetSubdomainSection]);

  // Handle tool selection (creates new tab or switches to existing)
  const handleToolClick = useCallback((toolId: string) => {
    const tool = tools.find(t => t.id === toolId);
    if (!tool) return;
    
    // FIX: Just select the tool, don't create sessions yet
    // Sessions are created when user clicks "Enumerate" button
    setSelectedTool(toolId);
    showToast(`${tool.name} selected`, 'info');
  }, [setSelectedTool, showToast]);
  
  // Handle tab switch
  const handleTabSwitch = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    const session = toolSessions.find(s => s.toolId === sessionId);
    if (session) {
      setDomain(session.domain);
      setSelectedTool(tools.find(t => t.name === session.toolName)?.id || null);
    }
  }, [toolSessions]);
  
  // Cancel only the active session. Other subdomain tabs remain independent.
  const handleCancelScan = useCallback(() => {
    void cancelSubdomainSession(activeSessionId, true);
  }, [activeSessionId, cancelSubdomainSession]);

  // STARTUP FIX: Don't auto-start terminal - let Terminal component handle it
  // Terminal will create PTY when user first clicks on it
  // This prevents startup freeze from automatic PTY creation

  // Hide right-click hint after first use
  useEffect(() => {
    const hasSeenHint = localStorage.getItem('subdomain-rightclick-hint-seen');
    if (hasSeenHint) {
      setShowRightClickHint(false);
    }
  }, []);

  // Filtered and sorted subdomains
  const filteredAndSortedSubdomains = useMemo(() => {
    let filtered = subdomains;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (sub) =>
          sub.subdomain.toLowerCase().includes(query) ||
          sub.ip.toLowerCase().includes(query) ||
          (sub.ports && sub.ports.toLowerCase().includes(query))
      );
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((sub) => sub.status === statusFilter);
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'subdomain':
          comparison = a.subdomain.localeCompare(b.subdomain);
          break;
        case 'ip':
          comparison = a.ip.localeCompare(b.ip);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'ports':
          comparison = (a.ports || '').localeCompare(b.ports || '');
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [subdomains, searchQuery, statusFilter, sortField, sortOrder]);

  // Keyboard shortcuts for context menus and bulk select
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setContextMenu(null);
      setToolContextMenu(null);
      setBulkSelectMode(false);
      setSelectedSubdomains(new Set());
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isActive, handleKeyDown]);

  const tools = [
    { 
      id: 'subfinder', 
      name: 'Subfinder', 
      description: 'Fast subdomain discovery', 
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5"/>
          <path d="M8.5 8.5v.01"/>
          <path d="M16 15.5v.01"/>
          <path d="M12 12v.01"/>
          <path d="M11 17v.01"/>
          <path d="M7 14v.01"/>
        </svg>
      )
    },
    { 
      id: 'amass', 
      name: 'Amass', 
      description: 'In-depth DNS enumeration', 
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <circle cx="12" cy="12" r="8"/>
          <path d="M12 2v4"/>
          <path d="M12 18v4"/>
          <path d="M4.93 4.93l2.83 2.83"/>
          <path d="M16.24 16.24l2.83 2.83"/>
          <path d="M2 12h4"/>
          <path d="M18 12h4"/>
          <path d="M4.93 19.07l2.83-2.83"/>
          <path d="M16.24 7.76l2.83-2.83"/>
        </svg>
      )
    },
    { 
      id: 'assetfinder', 
      name: 'Assetfinder', 
      description: 'Find domains and subdomains', 
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
          <circle cx="12" cy="7" r="1" fill="currentColor"/>
        </svg>
      )
    },
    { 
      id: 'sublist3r', 
      name: 'Sublist3r', 
      description: 'Python subdomain enumeration', 
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4"/>
          <path d="M3 12h18"/>
        </svg>
      )
    },
    { 
      id: 'ffuf', 
      name: 'ffuf', 
      description: 'Fast web fuzzer for subdomains', 
      icon: (
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
      )
    },
  ];

  const handleScan = async () => {
    if (!domain || !window.electron || !selectedTool) {
      if (!selectedTool) {
        showToast('Please select a tool first', 'warning');
      } else if (!domain) {
        showToast('Please enter a domain', 'warning');
      }
      return;
    }
    
    // FIX: Prevent multiple scans at once
    if (isScanning || activeSubdomainRunsRef.current.has(activeSessionId)) {
      showToast('A scan is already running. Please wait or cancel it first.', 'warning');
      return;
    }
    
    // EDGE CASE: Strip protocol, path, port, and validate domain
    let cleanDomain = domain.trim();
    cleanDomain = cleanDomain.replace(/^https?:\/\//, ''); // Remove http:// or https://
    cleanDomain = cleanDomain.replace(/\/.*$/, ''); // Remove path
    cleanDomain = cleanDomain.replace(/:\d+$/, ''); // Remove port
    cleanDomain = cleanDomain.toLowerCase().replace(/\.$/, ''); // Normalize to lowercase/FQDN form
    
    // EDGE CASE: Validate domain format
    if (!cleanDomain || !cleanDomain.match(/^[a-z0-9.-]+\.[a-z]{2,}\.?$/i)) {
      showToast('Please enter a valid domain (e.g., example.com)', 'error');
      setError('Invalid domain format. Please enter a valid domain like example.com');
      return;
    }

    // EDGE CASE: Check if domain has at least 2 parts
    const domainParts = cleanDomain.split('.');
    if (domainParts.length < 2) {
      showToast('Domain must have at least 2 parts (e.g., example.com)', 'error');
      setError('Invalid domain format. Domain must have at least 2 parts.');
      return;
    }
    
    const sessionId = activeSessionId;
    const toolId = selectedTool;
    const toolName = tools.find(t => t.id === toolId)?.name || toolId;
    const customFlags = activeSession?.customFlags?.trim();
    const processId = `subdomain-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // A Stop request marks the session idle immediately, but wait for the
    // Electron child-process cancellation to finish before starting the next
    // run. This prevents a fast Stop -> Start from briefly running both tools.
    const pendingStop = pendingSubdomainStopsRef.current.get(sessionId);
    if (pendingStop) {
      await pendingStop;
    }

    // The tab may have been closed while Stop was awaiting Electron. Do not
    // resurrect a session that no longer exists in the view.
    if (!toolSessionsRef.current.some(session => session.toolId === sessionId)) {
      return;
    }

    if (activeSubdomainRunsRef.current.has(sessionId)) {
      showToast('A scan is already running. Please wait or cancel it first.', 'warning');
      return;
    }

    let attackSessionId: string | undefined;
    try {
      const { useAttackState } = await import('@/lib/attack-state-store');
      attackSessionId = useAttackState.getState().session?.id;
    } catch (error) {
      console.debug('[SubdomainView] Could not capture attack-session provenance:', error);
    }

    setError(null);
    activeSubdomainRunsRef.current.set(sessionId, processId);
    setStoredDomain(cleanDomain);
    // A new run replaces the visible result set. This prevents a completed
    // result from a previous domain/tool from remaining on screen when the
    // new run returns no findings or is cancelled.
    setStoredSubdomains([]);
    
    // FIX: Update active session to show it's scanning
    setToolSessions(prev => prev.map(s => 
      s.toolId === sessionId 
        ? { ...s, isActive: true, toolName, domain: cleanDomain, subdomains: [] }
        : s
    ));

    showToast(`Starting ${toolName} scan on ${cleanDomain}`, 'info');

    try {
      // Ensure the visible terminal exists before the tool starts streaming.
      // The tool process remains independently cancellable, while its output
      // is routed into this session's terminal.
      await terminalService.getOrCreateTerminal(sessionId, 'scan');
      if (
        !isCurrentSubdomainRun(sessionId, processId) ||
        !toolSessionsRef.current.some(session => session.toolId === sessionId)
      ) return;
      terminalService.getOrCreatePTY(sessionId, 'scan');
      terminalService.attachPTY(sessionId, sessionId);
      const terminalReady = await waitForTerminalReady(sessionId, 5000);
      if (!terminalReady) {
        throw new Error('Subdomain terminal did not become ready');
      }
      terminalService.setTerminalProvenance(sessionId, {
        sessionId: attackSessionId,
        runId: processId,
        target: cleanDomain,
      });
      terminalService.markTerminalEvidenceStart(sessionId);
      if (!isCurrentSubdomainRun(sessionId, processId)) return;

      // Register before invoking Electron: the child can emit its first chunk
      // immediately, and the route must survive this view being unmounted.
      terminalService.registerExternalOutputRoute(processId, sessionId);

      const result = await window.electron.executeSubdomainTool({
        tool: toolId,
        domain: cleanDomain,
        toolId: processId,
        terminalId: sessionId,
        ...(customFlags && { customFlags }), // Add custom flags if present
      });

      if (!isCurrentSubdomainRun(sessionId, processId)) return;

      // The Electron completion can race the listener-exit event. Force a
      // bounded capture flush before publishing any success/failure UI so an
      // immediate AI request sees the final subdomain evidence.
      const { flushToolOutputCapture } = await import('@/lib/tool-output-capture');
      const captureFlushed = await flushToolOutputCapture(processId, result.success ? 0 : 1);

      console.log(`[SubdomainView] Tool result:`, { 
        success: result.success, 
        hasOutput: Boolean(result.output || result.stderr),
        outputLength: (result.output?.length || 0) + (result.stderr?.length || 0),
        hasError: Boolean(result.error),
      });

      const streamOutput = [result.output, result.stderr]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join('\n');
      const combinedOutput = [
        streamOutput,
        !result.success ? result.error : undefined,
      ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .join('\n');

      if (!captureFlushed && combinedOutput.trim()) {
        await recordSubdomainEvidence(
          sessionId,
          cleanDomain,
          toolId,
          combinedOutput,
          [],
          attackSessionId,
          processId,
        );
      }

      if (result.success) {
        if (combinedOutput.length > 0) {
          console.log(`[SubdomainView] Received output, length: ${combinedOutput.length}`);
          
          // EDGE CASE: Check if output contains actual subdomains or just errors
          // Parsing, rather than a dot/line heuristic, decides whether the
          // output contains valid results.
          const hasActualContent = combinedOutput.trim().length > 0;

          const { parseSubdomainOutput } = await import('@/lib/subdomain-parser');
          const parsed = parseSubdomainOutput(toolId, combinedOutput, cleanDomain);
          if (!hasActualContent || parsed.subdomains.length === 0) {
            console.warn('[SubdomainView] Output contains no valid subdomains');
            const scopeNote = cleanDomain.split('.').length > 2
              ? ` ${cleanDomain} is already a subdomain, so the tool searches for deeper names below it.`
              : '';
            setError(`${toolName} completed but returned no discoverable subdomains for ${cleanDomain}.${scopeNote} Check the terminal output, API/source configuration, or try the parent domain if that is your intended scope.`);
            showToast(`No subdomains discovered`, 'warning');
            
            // Don't add to error store for "no results"
            return;
          }
          
          console.log(`[SubdomainView] Parsed ${parsed.subdomains.length} subdomains`);
          console.log(`[SubdomainView] Summary:`, parsed.summary);
          
          const foundSubdomains: Subdomain[] = parsed.subdomains.map(s => ({
            subdomain: s.subdomain,
            ip: s.ip || 'Unknown',
            // Unknown is meaningful: discovery tools do not prove liveness
            // unless they actually returned an address/HTTP result.
            status: s.status || 'unknown',
            ports: s.ports?.join(', ') || (s.httpStatus ? `HTTP ${s.httpStatus}` : 'Unknown'),
          }));

          // EDGE CASE: Handle empty results after parsing
          if (foundSubdomains.length === 0) {
            setError(`No subdomains discovered for ${cleanDomain}. Try a different tool or check if the domain exists.`);
            showToast(`No subdomains found`, 'info');
            
            // DON'T add to error store - just show in main UI
          } else {
            // FIX: Update session with results (each tab is independent)
            setToolSessions(prev => prev.map(s => 
              s.toolId === sessionId 
                ? { ...s, subdomains: foundSubdomains, isActive: false }
                : s
            ));
            setStoredDomain(cleanDomain);
            setStoredSubdomains(foundSubdomains);
            
            showToast(`Found ${foundSubdomains.length} subdomains`, 'success');
            
            // Add to global context for cross-section AI awareness
            import('@/lib/global-context-store').then(({ globalContextStore }) => {
              globalContextStore.addActivity({
                type: 'subdomain',
                timestamp: Date.now(),
                domain: cleanDomain,
                tool: toolId,
                subdomainsFound: foundSubdomains.length,
                subdomains: foundSubdomains.map(s => ({
                  subdomain: s.subdomain,
                  ip: s.ip,
                  status: s.status,
                })),
              });
            });
          }
        } else {
          // The executable was validated and exited successfully; empty output
          // means no findings were returned, not automatically that the tool is
          // missing.
          setError(`${toolName} completed successfully but returned no output or findings for ${cleanDomain}. Check the terminal output and tool/source configuration.`);
          showToast(`No output from ${toolName}`, 'warning');
          
          // DON'T add to error store for "no results" - only for actual errors
        }
      } else {
        // EDGE CASE: Tool execution failed - show detailed error
        const errorMsg = result.error || 'Tool execution failed';
        console.error(`[SubdomainView] Tool execution failed:`, errorMsg);
        
        // Provide helpful error messages based on error type
        let userFriendlyError = errorMsg;
        if (errorMsg.includes('OSECBOX_DNS_PREFLIGHT_FAILED')) {
          userFriendlyError = `DNS preflight blocked ${toolName}. The tool did not start.\n\n${errorMsg}`;
        } else if (/failed to resolve|could not resolve|name or service not known|no such host/i.test(errorMsg)) {
          userFriendlyError = `${toolName} could not resolve ${cleanDomain}. Run Settings → Platform & WSL2 → DNS preflight to distinguish a local resolver/VPN problem from a target-specific DNS record.`;
        } else if (errorMsg.includes('not found') || errorMsg.includes('command not found')) {
          userFriendlyError = `${toolName} is not installed. Install it first: sudo apt install ${toolId}`;
        } else if (errorMsg.includes('permission denied')) {
          userFriendlyError = `Permission denied. Try: sudo ${toolName}`;
        } else if (errorMsg.includes('connection') || errorMsg.includes('network')) {
          userFriendlyError = `Network error. Check your internet connection.`;
        }
        
        setError(userFriendlyError);
        showToast(`Tool failed: ${errorMsg}`, 'error');
        
        // Add to error store
        addError('subdomain', {
          type: 'error',
          title: `${toolName} Failed`,
          message: errorMsg,
          details: result.error,
          tool: toolId,
          target: cleanDomain,
        });
      }
    } catch (error: any) {
      if (!isCurrentSubdomainRun(sessionId, processId)) return;
      console.error(`[SubdomainView] Exception:`, error);
      const errorMsg = error.message || error.toString();
      
      // EDGE CASE: Handle different exception types
      let userFriendlyError = `Scan failed: ${errorMsg}`;
      if (errorMsg.includes('timeout')) {
        userFriendlyError = `Scan timed out. Try a different tool or smaller domain.`;
      } else if (errorMsg.includes('ENOENT')) {
        userFriendlyError = `${toolName} not found. Install it first.`;
      }
      
      setError(userFriendlyError);
      showToast(`Scan failed: ${errorMsg}`, 'error');
      
      // Add to error store
      addError('subdomain', {
        type: 'error',
        title: 'Subdomain Scan Failed',
        message: errorMsg,
        details: error.stack,
          tool: toolId || 'unknown',
        target: cleanDomain,
      });
    } finally {
      if (isCurrentSubdomainRun(sessionId, processId)) {
        activeSubdomainRunsRef.current.delete(sessionId);
        terminalService.unregisterExternalOutputRoute(processId);
        // Keep the terminal reusable after every natural completion/error.
        terminalService.writeExternalOutput(sessionId, '\r\n$ ', true);
        setToolSessions(prev => prev.map(s =>
          s.toolId === sessionId ? { ...s, isActive: false } : s
        ));
      }
    }
  };

  const handleSendToScan = useCallback((subdomain: Subdomain) => {
    addScanTab(subdomain.ip);
    showToast(`Scanning ${subdomain.subdomain} (${subdomain.ip})`, 'success');
  }, [addScanTab, showToast]);

  const handleCopyIP = useCallback((ip: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(ip);
      showToast(`IP copied: ${ip}`, 'success');
    }
  }, [showToast]);

  const handleCopySubdomain = useCallback((subdomain: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(subdomain);
      showToast(`Subdomain copied: ${subdomain}`, 'success');
    }
    setContextMenu(null);
  }, [showToast]);

  const handleOpenInBrowser = useCallback((subdomain: string) => {
    window.open(`http://${subdomain}`, '_blank');
    showToast(`Opening ${subdomain} in browser`, 'info');
    setContextMenu(null);
  }, [showToast]);

  const handleScanWithNmap = useCallback((subdomain: Subdomain) => {
    addScanTab(subdomain.ip);
    showToast(`Starting Nmap scan on ${subdomain.subdomain}`, 'success');
    setContextMenu(null);
  }, [addScanTab, showToast]);

  const handleContextMenu = useCallback((e: React.MouseEvent, subdomain: Subdomain) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, subdomain });
    
    // Hide hint after first right-click
    if (showRightClickHint) {
      setShowRightClickHint(false);
      localStorage.setItem('subdomain-rightclick-hint-seen', 'true');
    }
  }, [showRightClickHint]);

  const handleToolContextMenu = useCallback((e: React.MouseEvent, toolId: string) => {
    e.preventDefault();
    setToolContextMenu({ x: e.clientX, y: e.clientY, toolId });
  }, []);

  const handleOpenToolSettings = useCallback(() => {
    navigateToSettings('settings-subdomain');
    setToolContextMenu(null);
  }, [navigateToSettings]);

  const toggleSubdomainSelection = useCallback((subdomain: string) => {
    setSelectedSubdomains((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(subdomain)) {
        newSet.delete(subdomain);
      } else {
        newSet.add(subdomain);
      }
      return newSet;
    });
  }, []);

  const selectAllSubdomains = useCallback(() => {
    setSelectedSubdomains(new Set(filteredAndSortedSubdomains.map((s) => s.subdomain)));
    showToast(`Selected ${filteredAndSortedSubdomains.length} subdomains`, 'info');
  }, [filteredAndSortedSubdomains, showToast]);

  const deselectAllSubdomains = useCallback(() => {
    setSelectedSubdomains(new Set());
    showToast('Selection cleared', 'info');
  }, [showToast]);

  const copySelectedSubdomains = useCallback(() => {
    const selected = filteredAndSortedSubdomains.filter((s) =>
      selectedSubdomains.has(s.subdomain)
    );
    const text = selected.map((s) => s.subdomain).join('\n');
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showToast(`Copied ${selected.length} subdomains`, 'success');
    }
  }, [filteredAndSortedSubdomains, selectedSubdomains, showToast]);

  const exportResults = useCallback(() => {
    const dataToExport = selectedSubdomains.size > 0
      ? filteredAndSortedSubdomains.filter((s) => selectedSubdomains.has(s.subdomain))
      : filteredAndSortedSubdomains;

    if (dataToExport.length === 0) {
      showToast('No subdomains to export', 'warning');
      return;
    }

    const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      'Subdomain,IP Address,Status,Ports',
      ...dataToExport.map((s) => [s.subdomain, s.ip, s.status, s.ports || 'N/A'].map(csvCell).join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `subdomains-${domain}-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 250);
    
    showToast(`Exported ${dataToExport.length} subdomains`, 'success');
  }, [filteredAndSortedSubdomains, selectedSubdomains, domain, showToast]);

  const clearSubdomainResults = useCallback(() => {
    if (isScanning) return;

    setToolSessions(prev => prev.map(session =>
      session.toolId === activeSessionId
        ? { ...session, subdomains: [], isActive: false }
        : session
    ));
    setStoredSubdomains([]);
    setSelectedSubdomains(new Set());
    setSelectedSubdomain(null);
    setSearchQuery('');
    setStatusFilter('all');
    setBulkSelectMode(false);
    setError(null);
    showToast('Subdomain results cleared', 'info');
  }, [activeSessionId, isScanning, setStoredSubdomains, showToast]);

  const isNoResultsError = Boolean(error && /no subdomains|no output/i.test(error));
  const isToolUnavailableError = Boolean(
    error && /not installed|not found|tool unavailable|wsl2 unavailable|selected execution environment/i.test(error),
  );

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  }, [sortField]);

  return (
    <ViewWithSidebar sectionId="subdomains" showSidebar={isActive}>
      <ViewErrorBoundary viewName="subdomain" onRetry={handleScan}>
        <div className="h-full flex flex-col bg-background">
        <TabBar currentView="subdomains" viewType="subdomain" />
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
          {/* Main Content */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <SmoothResizable
              defaultBottomHeight={getPanelSize('subdomain-vertical-layout', 'terminal-panel', 40)}
              minBottomHeight={5}
              maxBottomHeight={95}
              onResizeStart={handleTerminalResizeStart}
              onResizeEnd={handleTerminalResizeEnd}
              topContent={
                <div className="flex flex-col h-full min-h-0 bg-background">
                      {/* Status Bar - Shows current selection */}
                      <div className="h-8 bg-muted/30 border-b border-border flex items-center px-4 gap-3 flex-shrink-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Tool:</span>
                          <span className="font-semibold text-foreground">
                            {selectedTool ? tools.find(t => t.id === selectedTool)?.name || 'None' : 'None'}
                          </span>
                        </div>
                        <div className="h-3 w-px bg-border" />
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground">Domain:</span>
                          <span className="font-semibold text-foreground font-mono">
                            {domain || 'No domain'}
                          </span>
                        </div>
                        {isScanning && (
                          <>
                            <div className="h-3 w-px bg-border" />
                            <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
                              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                              <span className="font-semibold">Scanning...</span>
                            </div>
                          </>
                        )}
                      </div>
                      
                      {/* Scanning Status Banner - Hidden, using centered animation instead */}
                      
                      {/* Header with Controls */}
                      <div className="p-4 border-b border-border bg-card space-y-3">
                        <div className="flex items-center gap-3">
                          <Globe className="w-5 h-5 text-blue-500" />
                        <div className="flex-1">
                          <h2 className="text-sm font-bold text-foreground">Subdomain Enumeration</h2>
                          <p className="text-xs text-muted-foreground">Discover subdomains</p>
                        </div>
                        
                        {/* WSL2 Status Badge (Windows only) */}
                        {platformInfo?.isWindows && (
                          <div className="flex items-center gap-2">
                            <WSL2StatusBadge size="sm" />
                            {platformInfo.wsl2Status !== 'available' && (
                              <Button
                                onClick={() => setShowWSL2Dialog(true)}
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                              >
                                <AlertCircle className="w-3 h-3 mr-1" />
                                Setup WSL2
                              </Button>
                            )}
                          </div>
                        )}
                        
                        {/* View Controls */}
                        <div className="flex items-center gap-2">
                          {subdomains.length > 0 && (
                            <>
                              <Button
                                onClick={() => setBulkSelectMode(!bulkSelectMode)}
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                title="Bulk select mode"
                              >
                                {bulkSelectMode ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                              </Button>
                              
                              <div className="flex border border-border rounded-md overflow-hidden">
                                <button type="button"
                                  onClick={() => setViewDensity('compact')}
                                  className={`px-2 py-1 text-xs transition-colors ${viewDensity === 'compact' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                                  title="Compact view"
                                >
                                  <Grid3x3 className="w-3 h-3" />
                                </button>
                                <button type="button"
                                  onClick={() => setViewDensity('comfortable')}
                                  className={`px-2 py-1 text-xs transition-colors border-x border-border ${viewDensity === 'comfortable' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                                  title="Comfortable view"
                                >
                                  <Layers className="w-3 h-3" />
                                </button>
                                <button type="button"
                                  onClick={() => setViewDensity('line')}
                                  className={`px-2 py-1 text-xs transition-colors ${viewDensity === 'line' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                                  title="Line view - horizontal rows"
                                >
                                  <List className="w-3 h-3" />
                                </button>
                              </div>
                              
                              <Button onClick={exportResults} variant="outline" size="sm" className="h-7 text-xs">
                                <Download className="w-3 h-3 mr-1" />
                                Export
                              </Button>
                              <Button
                                onClick={clearSubdomainResults}
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs text-destructive hover:text-destructive"
                                disabled={isScanning}
                                title="Clear results for this subdomain tab"
                              >
                                <Trash2 className="w-3 h-3 mr-1" />
                                Clear Results
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Input Section - Collapsible */}
                      <SubdomainInputSection
                        domain={domain}
                        onDomainChange={setDomain}
                        customFlags={activeSession?.customFlags || ''}
                        onCustomFlagsChange={(flags) => {
                          setToolSessions(prev => prev.map(s => 
                            s.toolId === activeSessionId 
                              ? { ...s, customFlags: flags }
                              : s
                          ));
                        }}
                        selectedTool={selectedTool}
                        isScanning={isScanning}
                        onScan={handleScan}
                        onCancel={handleCancelScan}
                        isCollapsed={isInputCollapsed}
                        onToggleCollapse={() => setIsInputCollapsed(!isInputCollapsed)}
                      />
                      
                      {/* Tool Selection - Only show when input is expanded */}
                      {!isInputCollapsed && (
                        <div className="px-4 pb-3">
                          <SubdomainToolSelector
                            tools={tools}
                            selectedTool={selectedTool}
                            onToolSelect={handleToolClick}
                            onToolContextMenu={handleToolContextMenu}
                            isScanning={isScanning}
                          />
                        </div>
                      )}
                    </div>

                    {/* Results Area */}
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                      {/* Results */}
                      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                        {!isPlatformReady ? (
                          <div className="flex flex-col h-full items-center justify-center text-center p-8">
                            <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
                              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                            </div>
                            <h3 className="text-lg font-semibold text-foreground mb-2">Initializing...</h3>
                            <p className="text-sm text-muted-foreground max-w-md">Detecting platform and checking tool availability</p>
                          </div>
                        ) : error && !isNoResultsError ? (
                          <div className="flex flex-col h-full items-center justify-center text-center p-8">
                            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                              <span className="text-4xl">❌</span>
                            </div>
                            <h3 className="text-lg font-semibold text-foreground mb-2">
                              {isToolUnavailableError ? 'Tool Unavailable' : 'Enumeration Failed'}
                            </h3>
                            <p className="text-sm text-muted-foreground max-w-md mb-4">{error}</p>
                            
                            {/* WSL2 Setup Button for Windows */}
                            {platformInfo?.isWindows && platformInfo.wsl2Status !== 'available' && (
                              <Button
                                onClick={() => setShowWSL2Dialog(true)}
                                className="mb-4 bg-blue-600 hover:bg-blue-500"
                              >
                                <AlertCircle className="w-4 h-4 mr-2" />
                                Setup WSL2 Now
                              </Button>
                            )}
                            
                            <div className="bg-muted/50 border border-border rounded-lg p-4 max-w-lg text-left">
                              <p className="text-xs font-semibold text-foreground mb-2">Quick Fix:</p>
                              <ul className="text-xs text-muted-foreground space-y-1">
                                <li>• <span className="font-mono">Linux/Kali:</span> Install tools (see SUBDOMAIN_TOOLS_SETUP.md)</li>
                                <li>• <span className="font-mono">Windows:</span> Use WSL2 with Ubuntu</li>
                                <li>• <span className="font-mono">Check:</span> Run <code className="bg-background px-1 rounded">subfinder -version</code> in terminal</li>
                              </ul>
                            </div>
                          </div>
                        ) : isScanning ? (
                          // Show centered scanning animation (like Nikto/Nuclei)
                          <div className="h-full flex items-center justify-center bg-background">
                            <div className="text-center max-w-sm select-none">
                              <Globe className="w-14 h-14 text-primary/70 mx-auto mb-5" strokeWidth={1.5} />
                              
                              <p className="text-base font-semibold text-foreground mb-4">Scanning in Progress</p>
                              
                              <div className="flex items-end justify-center gap-[5px] h-[18px] overflow-hidden">
                                {[0, 0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84].map((delay, i) => (
                                  <span
                                    key={i}
                                    className="block w-[7px] h-[7px] rounded-full bg-primary animate-bounce-dot"
                                    style={{ animationDelay: `${delay}s` }}
                                  />
                                ))}
                              </div>
                              
                              <p className="text-xs text-muted-foreground mt-5">
                                {selectedTool && tools.find(t => t.id === selectedTool)?.name} is enumerating {domain}. Results will appear here as they're discovered.
                              </p>
                            </div>
                          </div>
                        ) : subdomains.length === 0 ? (
                          <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
                            {error ? (
                              // Show error state when scan completed with no results
                              <>
                                <AlertCircle className="w-20 h-20 mb-4 text-yellow-500 opacity-50" />
                                <p className="text-lg font-semibold text-foreground mb-2">No Subdomains Found</p>
                                <p className="text-sm text-center max-w-md mb-4">{error}</p>
                                <div className="flex gap-2">
                                  <Button
                                    onClick={() => {
                                      setError(null);
                                      setDomain('');
                                    }}
                                    variant="outline"
                                    size="sm"
                                  >
                                    Try Different Domain
                                  </Button>
                                  <Button
                                    onClick={() => {
                                      setError(null);
                                      handleScan();
                                    }}
                                    variant="default"
                                    size="sm"
                                    disabled={!selectedTool || !domain}
                                  >
                                    Retry Scan
                                  </Button>
                                </div>
                                <div className="mt-6 text-xs text-muted-foreground space-y-1 text-center">
                                  <p>💡 Try a different tool - each tool has different data sources</p>
                                  <p>🌐 Some domains genuinely have no subdomains</p>
                                  <p>🔧 Check the terminal output below for detailed error messages</p>
                                </div>
                              </>
                            ) : (
                              // Show initial empty state
                              <>
                                <Globe className="w-16 h-16 mb-4 opacity-20" />
                                <p className="text-sm">Enter a domain and click Enumerate to discover subdomains</p>
                                <p className="text-xs mt-2">Results will appear as cards with IP addresses and ports</p>
                                <div className="mt-4 text-xs text-muted-foreground space-y-1">
                                  <p>💡 <span className="font-semibold">Tip:</span> Right-click on cards for quick actions</p>
                                  <p>⌨️ <span className="font-semibold">Keyboard:</span> Use arrow keys to navigate, Enter to select</p>
                                </div>
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="h-full flex flex-col">
                            {/* Search and Filter Bar */}
                            <SubdomainFilterBar
                              searchQuery={searchQuery}
                              onSearchChange={setSearchQuery}
                              statusFilter={statusFilter}
                              onStatusFilterChange={setStatusFilter}
                              sortField={sortField}
                              sortOrder={sortOrder}
                              onSortChange={toggleSort}
                              showFilters={showFilters}
                              onToggleFilters={() => setShowFilters(!showFilters)}
                            />
                            
                            {/* Stats and Bulk Actions */}
                            <SubdomainStatsBar
                              totalCount={subdomains.length}
                              filteredCount={filteredAndSortedSubdomains.length}
                              activeCount={subdomains.filter(s => s.status === 'active').length}
                              inactiveCount={subdomains.filter(s => s.status === 'inactive').length}
                              bulkSelectMode={bulkSelectMode}
                              selectedCount={selectedSubdomains.size}
                              onSelectAll={selectAllSubdomains}
                              onDeselectAll={deselectAllSubdomains}
                              onCopySelected={copySelectedSubdomains}
                            />

                            {/* Card Grid */}
                            <SubdomainResultsGrid
                              subdomains={filteredAndSortedSubdomains}
                              viewDensity={viewDensity}
                              bulkSelectMode={bulkSelectMode}
                              selectedSubdomains={selectedSubdomains}
                              selectedSubdomain={selectedSubdomain}
                              onSubdomainClick={(subdomain) => {
                                if (bulkSelectMode) {
                                  toggleSubdomainSelection(subdomain);
                                } else {
                                  setSelectedSubdomain(subdomain);
                                }
                              }}
                              onSubdomainContextMenu={handleContextMenu}
                              onToggleSelection={toggleSubdomainSelection}
                              onSendToScan={handleSendToScan}
                              onCopyIP={handleCopyIP}
                              showRightClickHint={showRightClickHint}
                              onClearFilters={() => {
                                setSearchQuery('');
                                setStatusFilter('all');
                              }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Context Menus */}
                      <SubdomainContextMenu
                        contextMenu={contextMenu}
                        toolContextMenu={toolContextMenu}
                        onClose={() => {
                          setContextMenu(null);
                          setToolContextMenu(null);
                        }}
                        onScanWithNmap={handleScanWithNmap}
                        onCopySubdomain={handleCopySubdomain}
                        onCopyIP={(ip) => {
                          handleCopyIP(ip);
                          setContextMenu(null);
                        }}
                        onOpenInBrowser={handleOpenInBrowser}
                        onOpenToolSettings={handleOpenToolSettings}
                        onCopyAsCSV={(subdomain) => {
                          if (typeof navigator !== 'undefined' && navigator.clipboard) {
                            navigator.clipboard.writeText(`${subdomain.subdomain},${subdomain.ip}`);
                            showToast('Copied as CSV', 'success');
                          }
                          setContextMenu(null);
                        }}
                      />
                    </div>
                  </div>
              }
              bottomContent={
                <SubdomainTerminalPanel
                  toolSessions={toolSessions}
                  activeSessionId={activeSessionId}
                  activeSession={activeSession}
                  selectedTool={selectedTool}
                  domain={domain}
                  isScanning={isScanning}
                  tools={tools}
                  onCancel={handleCancelScan}
                  isActive={isActive}
                  isResizing={isTerminalResizing}
                />
              }
              className="flex-1 min-h-0"
            />
          </div>
        </div>
      </div>
      
      {/* WSL2 Setup Dialog */}
      <WSL2SetupDialog open={showWSL2Dialog} onOpenChange={setShowWSL2Dialog} />
      </ViewErrorBoundary>
    </ViewWithSidebar>
  );
}
