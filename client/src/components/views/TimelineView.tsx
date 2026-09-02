/**
 * Timeline View - Visual Calendar Scheduler for Security Tools
 */

import React, { useState, useEffect } from 'react';
import { Play, Trash2, Target, Globe, Zap, FolderSearch, Shield, X, History, CheckCircle2, XCircle, Clock as ClockIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Scheduler, ScheduledScan } from '@/lib/scheduler';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';

type ToolType = 'nmap' | 'nikto' | 'nuclei' | 'dirbuster' | 'metasploit';

interface ToolCard {
  id: ToolType;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  bgClass: string;
  borderClass: string;
  textClass: string;
  hoverClass: string;
  description: string;
}

const AVAILABLE_TOOLS: ToolCard[] = [
  { 
    id: 'nmap', 
    name: 'Nmap', 
    icon: Target, 
    bgClass: 'bg-blue-500/20', 
    borderClass: 'border-blue-500/40',
    textClass: 'text-blue-500',
    hoverClass: 'hover:border-blue-500',
    description: 'Network scanning' 
  },
  { 
    id: 'nikto', 
    name: 'Nikto', 
    icon: Globe, 
    bgClass: 'bg-green-500/20', 
    borderClass: 'border-green-500/40',
    textClass: 'text-green-500',
    hoverClass: 'hover:border-green-500',
    description: 'Web vulnerabilities' 
  },
  { 
    id: 'nuclei', 
    name: 'Nuclei', 
    icon: Zap, 
    bgClass: 'bg-yellow-500/20', 
    borderClass: 'border-yellow-500/40',
    textClass: 'text-yellow-500',
    hoverClass: 'hover:border-yellow-500',
    description: 'CVE templates' 
  },
  { 
    id: 'dirbuster', 
    name: 'DirBuster', 
    icon: FolderSearch, 
    bgClass: 'bg-purple-500/20', 
    borderClass: 'border-purple-500/40',
    textClass: 'text-purple-500',
    hoverClass: 'hover:border-purple-500',
    description: 'Directory brute-force' 
  },
  { 
    id: 'metasploit', 
    name: 'Metasploit', 
    icon: Shield, 
    bgClass: 'bg-red-500/20', 
    borderClass: 'border-red-500/40',
    textClass: 'text-red-500',
    hoverClass: 'hover:border-red-500',
    description: 'Exploitation' 
  },
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function TimelineView() {
  const { showToast } = useToast();
  const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electron);
  const [scheduledScans, setScheduledScans] = useState<ScheduledScan[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<import('@/lib/scheduler').TimelineEvent[]>([]);
  const [selectedTool, setSelectedTool] = useState<ToolType | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ day: number; hour: number } | null>(null);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [scanConfig, setScanConfig] = useState({ target: '', flags: '' });

  useEffect(() => {
    if (!showConfigDialog) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShowConfigDialog(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [showConfigDialog]);

  // CRITICAL OPTIMIZATION: Defer scheduled scans loading
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    // FIX: Initialize scheduler executor immediately
    Scheduler.initializeExecutor().then(() => {
      console.log('[TimelineView] Scheduler executor initialized');
    }).catch((error) => {
      console.error('[TimelineView] Failed to initialize scheduler executor:', error);
    });
    
    // Load immediately so the first paint reflects persisted schedules. The
    // old three-second delay made the first interaction look broken.
    loadScheduledScans();
    interval = setInterval(loadScheduledScans, 5000);
    
    return () => {
      clearInterval(interval);
    };
  }, []);

  const loadScheduledScans = () => {
    setScheduledScans(Scheduler.getAllScheduledScans());
    setTimelineEvents(Scheduler.getTimeline(50)); // Load last 50 events
  };

  const handleToolSelect = (tool: ToolType) => {
    setSelectedTool(selectedTool === tool ? null : tool);
  };

  const handleSlotClick = (day: number, hour: number) => {
    if (!selectedTool) return;
    setSelectedSlot({ day, hour });
    setShowConfigDialog(true);
  };

  const handleScheduleScan = () => {
    if (!selectedTool || !selectedSlot || !scanConfig.target.trim()) return;

    const tool = AVAILABLE_TOOLS.find(t => t.id === selectedTool)!;

    const cronSchedule = `0 ${selectedSlot.hour} * * ${selectedSlot.day}`;

    try {
      Scheduler.addScheduledScan({
        name: `${tool.name} - ${scanConfig.target}`,
        tool: selectedTool,
        target: scanConfig.target.trim(),
        flags: scanConfig.flags.trim() || getDefaultFlags(selectedTool),
        schedule: cronSchedule,
        enabled: true,
        createdBy: 'user',
      });
    } catch (error: any) {
      showToast(error?.message || 'Could not schedule the scan', 'error');
      return;
    }

    setShowConfigDialog(false);
    setScanConfig({ target: '', flags: '' });
    setSelectedTool(null);
    setSelectedSlot(null);
    loadScheduledScans();
  };

  const getDefaultFlags = (tool: ToolType): string => {
    const defaults: Record<ToolType, string> = {
      nmap: '-sV -sC',
      nikto: '', // FIX: Nikto uses settings, not custom flags
      nuclei: '', // FIX: Nuclei uses settings, not custom flags
      dirbuster: '', // FIX: Gobuster uses settings, not custom flags
      metasploit: '', // FIX: Metasploit not supported
    };
    return defaults[tool];
  };
  
  const supportsCustomFlags = (tool: ToolType): boolean => {
    // Only nmap supports custom flags in scheduler
    // Other tools use settings from Settings panel
    return tool === 'nmap';
  };

  const getScheduledScansForSlot = (day: number, hour: number) => {
    return scheduledScans.filter(scan => {
      const parts = scan.schedule.split(' ');
      if (parts.length !== 5) return false;
      const [minute, schedHour, , , schedDay] = parts;
      return parseInt(schedHour) === hour && (schedDay === '*' || parseInt(schedDay) === day);
    });
  };

  const handleDeleteScan = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    e.preventDefault();
    
    console.log('[TimelineView] Deleting scan:', id);
    const success = Scheduler.removeScheduledScan(id);
    console.log('[TimelineView] Delete result:', success);
    
    if (success) {
      loadScheduledScans();
    } else {
      console.error('[TimelineView] Failed to delete scan:', id);
    }
  };

  const handleRunNow = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await Scheduler.triggerScanNow(id);
    loadScheduledScans();
  };

  const handleCancelDialog = () => {
    setShowConfigDialog(false);
    setScanConfig({ target: '', flags: '' });
    setSelectedSlot(null);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold mb-2">Security Tool Scheduler</h2>
            <p className="text-sm text-muted-foreground">
              Select a tool, then click a calendar slot to schedule an automated scan. Schedules execute while OsecBox is open.
            </p>
            {!isDesktopRuntime && (
              <p className="text-xs text-yellow-400 mt-2">
                Browser preview: schedules can be drafted and saved locally, but execution requires the packaged Electron app and its configured tool runtime.
              </p>
            )}
          </div>
          <Button
            onClick={() => setShowHistoryPanel(!showHistoryPanel)}
            variant="outline"
            className="flex items-center gap-2"
          >
            <History className="w-4 h-4" />
            {showHistoryPanel ? 'Hide History' : 'Show History'}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Tool Palette */}
        <div className="w-64 border-r border-border bg-card p-4 overflow-y-auto">
          <h3 className="text-sm font-bold mb-4 text-muted-foreground uppercase tracking-wide">
            Available Tools
          </h3>
          <div className="space-y-2">
            {AVAILABLE_TOOLS.map((tool) => {
              const Icon = tool.icon;
              const isSelected = selectedTool === tool.id;
              const isDisabled = tool.id === 'metasploit'; // Metasploit not supported yet
              
              return (
                <button
                  type="button"
                  key={tool.id}
                  onClick={() => !isDisabled && handleToolSelect(tool.id)}
                  disabled={isDisabled}
                  className={cn(
                    "w-full p-3 rounded-lg border-2 transition-all text-left",
                    isDisabled && "opacity-50 cursor-not-allowed",
                    !isDisabled && isSelected
                      ? `${tool.borderClass} ${tool.bgClass}`
                      : `border-border bg-background ${tool.hoverClass}`
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", tool.bgClass)}>
                      <Icon className={cn("w-5 h-5", tool.textClass)} />
                    </div>
                    <div className="flex-1">
                      <div className="font-bold text-sm flex items-center gap-2">
                        {tool.name}
                        {isDisabled && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-yellow-500/20 text-yellow-500 rounded">
                            Interactive only
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">{tool.description}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedTool && (
            <div className="mt-4 p-3 bg-primary/10 border border-primary/30 rounded-lg">
              <p className="text-xs text-primary font-medium">
                ✓ {AVAILABLE_TOOLS.find(t => t.id === selectedTool)?.name} selected
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Click a calendar slot to schedule
              </p>
            </div>
          )}
        </div>

        {/* Calendar Grid */}
        <div className="flex-1 overflow-auto p-6">
          <div className="min-w-[1200px]">
            {/* Header Row */}
            <div className="grid grid-cols-8 gap-2 mb-3 sticky top-0 bg-background z-10 pb-3">
              <div className="text-xs font-bold text-foreground uppercase tracking-wider bg-card border-2 border-border rounded-lg px-3 py-2 flex items-center justify-center shadow-sm">
                Time
              </div>
              {DAYS.map((day) => (
                <div key={day} className="text-xs font-bold text-center text-foreground uppercase tracking-wider bg-card border-2 border-border rounded-lg px-3 py-2 shadow-sm">
                  {day.slice(0, 3)}
                </div>
              ))}
            </div>

            {/* Time Slots */}
            {HOURS.map((hour) => (
              <div key={hour} className="grid grid-cols-8 gap-2 mb-2">
                <div className="flex items-center justify-center text-xs font-mono font-semibold text-foreground bg-card border-2 border-border rounded-lg px-3 py-2 shadow-sm">
                  {hour.toString().padStart(2, '0')}:00
                </div>
                {DAYS.map((_, dayIndex) => {
                  const scansInSlot = getScheduledScansForSlot(dayIndex, hour);
                  const hasScans = scansInSlot.length > 0;
                  return (
                    <div
                      key={`${dayIndex}-${hour}`}
                      role="button"
                      tabIndex={selectedTool ? 0 : -1}
                      aria-disabled={!selectedTool}
                      aria-label={`${DAYS[dayIndex]} at ${hour.toString().padStart(2, '0')}:00${hasScans ? `, ${scansInSlot.length} scheduled scan${scansInSlot.length === 1 ? '' : 's'}` : ''}`}
                      onClick={() => !selectedTool ? null : handleSlotClick(dayIndex, hour)}
                      onKeyDown={(event) => {
                        if (!selectedTool || (event.key !== 'Enter' && event.key !== ' ')) return;
                        event.preventDefault();
                        handleSlotClick(dayIndex, hour);
                      }}
                      className={cn(
                        "min-h-[60px] p-2 rounded-lg border-2 transition-all shadow-sm",
                        selectedTool
                          ? "border-dashed border-primary/60 hover:border-primary hover:bg-primary/10 hover:shadow-md cursor-pointer"
                          : "border-border bg-card/50 hover:bg-card cursor-default hover:shadow-md",
                        hasScans && "bg-accent/50 border-solid"
                      )}
                    >
                      {hasScans && (
                        <div className="space-y-1">
                          {scansInSlot.map((scan) => {
                            // Use scan.tool field instead of parsing name
                            const tool = AVAILABLE_TOOLS.find(t => t.id === scan.tool);
                            const Icon = tool?.icon || Target;
                            return (
                              <div
                                key={scan.id}
                                className={cn(
                                  "p-2 rounded border text-left group relative",
                                  tool?.bgClass || 'bg-blue-500/20',
                                  tool?.borderClass || 'border-blue-500/40'
                                )}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <Icon className="w-3 h-3 flex-shrink-0" />
                                  <span className="text-xs font-medium truncate flex-1">
                                    {scan.target}
                                  </span>
                                </div>
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  {(() => {
                                    const parts = scan.schedule.split(' ');
                                    const minute = parts[0] || '0';
                                    const hour = parts[1] || '0';
                                    const timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
                                    
                                    return timeStr;
                                  })()}
                                </div>
                                {scan.nextRun && (
                                  <div className="text-[9px] text-green-400 font-mono mt-0.5">
                                    Next: {new Date(scan.nextRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                )}
                                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                  <button
                                    type="button"
                                    onClick={(e) => handleRunNow(e, scan.id)}
                                    className="p-1 bg-green-500 rounded hover:bg-green-600 transition-colors"
                                    title="Run now"
                                  >
                                    <Play className="w-3 h-3 text-white fill-white" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => handleDeleteScan(e, scan.id)}
                                    className="p-1 bg-red-500 rounded hover:bg-red-600 transition-colors"
                                    title="Delete"
                                  >
                                    <Trash2 className="w-3 h-3 text-white" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* History Panel */}
      {showHistoryPanel && (
        <div className="border-t border-border bg-card">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Scan History</h3>
              <span className="text-sm text-muted-foreground">
                {timelineEvents.length} events
              </span>
            </div>
            
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {timelineEvents.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>No scan history yet</p>
                  <p className="text-xs mt-1">Scheduled scans will appear here</p>
                </div>
              ) : (
                timelineEvents.map((event) => {
                  const scan = scheduledScans.find(s => s.id === event.scanId);
                  const tool = AVAILABLE_TOOLS.find(t => t.id === (event.tool || scan?.tool));
                  const Icon = tool?.icon || Target;
                  
                  return (
                    <div
                      key={event.id}
                      className={cn(
                        "p-3 rounded-lg border-2 transition-all",
                        event.status === 'completed' && "border-green-500/40 bg-green-500/10",
                        event.status === 'failed' && "border-red-500/40 bg-red-500/10",
                        event.status === 'running' && "border-yellow-500/40 bg-yellow-500/10",
                        event.status === 'scheduled' && "border-blue-500/40 bg-blue-500/10"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded flex items-center justify-center flex-shrink-0",
                          tool?.bgClass || 'bg-blue-500/20'
                        )}>
                          <Icon className={cn("w-4 h-4", tool?.textClass || 'text-blue-500')} />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm truncate">
                              {event.scanName || scan?.name || 'Historical scheduled scan'}
                            </span>
                            {event.status === 'completed' && (
                              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                            )}
                            {event.status === 'failed' && (
                              <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                            )}
                            {event.status === 'running' && (
                              <Loader2 className="w-4 h-4 text-yellow-500 animate-spin flex-shrink-0" />
                            )}
                            {event.status === 'scheduled' && (
                              <ClockIcon className="w-4 h-4 text-blue-500 flex-shrink-0" />
                            )}
                          </div>
                          
                          <div className="text-xs text-muted-foreground font-mono">
                            {new Date(event.timestamp).toLocaleString()}
                          </div>
                          
                          {event.status === 'completed' && event.result?.output && (
                            <div className="mt-2 text-xs bg-background/50 p-2 rounded border border-border font-mono max-h-[100px] overflow-y-auto">
                              {event.result.output.slice(0, 200)}
                              {event.result.output.length > 200 && '...'}
                            </div>
                          )}
                          
                          {event.status === 'failed' && event.result?.error && (
                            <div className="mt-2 text-xs text-red-400 bg-red-500/10 p-2 rounded border border-red-500/30">
                              Error: {event.result.error}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Config Dialog */}
      {showConfigDialog && selectedTool && selectedSlot && (
        <div
          className="ui-dialog-overlay fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-scan-title"
          aria-describedby="schedule-scan-description"
          onClick={handleCancelDialog}
        >
          <div className="ui-popover-enter bg-card border border-border rounded-lg p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 id="schedule-scan-title" className="text-lg font-bold">
                Schedule {AVAILABLE_TOOLS.find(t => t.id === selectedTool)?.name}
              </h3>
              <p id="schedule-scan-description" className="sr-only">Configure a scheduled scan for the selected day and time.</p>
              <button
                type="button"
                onClick={handleCancelDialog}
                aria-label="Close schedule dialog"
                className="p-1 hover:bg-accent rounded transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Target</label>
                <input
                  type="text"
                  value={scanConfig.target}
                  onChange={(e) => setScanConfig({ ...scanConfig, target: e.target.value })}
                  placeholder="192.168.1.0/24 or example.com"
                  className="w-full px-3 py-2 bg-background border border-input rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && scanConfig.target.trim()) {
                      handleScheduleScan();
                    } else if (e.key === 'Escape') {
                      handleCancelDialog();
                    }
                  }}
                />
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Flags (optional)</label>
                {supportsCustomFlags(selectedTool) ? (
                  <input
                    type="text"
                    value={scanConfig.flags}
                    onChange={(e) => setScanConfig({ ...scanConfig, flags: e.target.value })}
                    placeholder={getDefaultFlags(selectedTool)}
                    className="w-full px-3 py-2 bg-background border border-input rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && scanConfig.target.trim()) {
                        handleScheduleScan();
                      } else if (e.key === 'Escape') {
                        handleCancelDialog();
                      }
                    }}
                  />
                ) : (
                  <div className="w-full px-3 py-2 bg-muted border border-border rounded text-sm text-muted-foreground">
                    This tool uses settings from the Settings panel
                  </div>
                )}
              </div>
              
              <div className="text-xs text-muted-foreground bg-accent p-3 rounded">
                <strong>Scheduled for:</strong> {DAYS[selectedSlot.day]} at {selectedSlot.hour.toString().padStart(2, '0')}:00 local time
              </div>
              
              <div className="flex gap-2">
                <Button
                  onClick={handleScheduleScan}
                  disabled={!scanConfig.target.trim()}
                  className="flex-1"
                >
                  Schedule Scan
                </Button>
                <Button
                  onClick={handleCancelDialog}
                  variant="outline"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
