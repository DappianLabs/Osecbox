import React, { useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Terminal, 
  Trash2, 
  RefreshCw, 
  Eye, 
  Camera,
  Users,
  Cpu,
  ArrowUp,
  Key,
  FileText,
  AlertCircle,
  Zap,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { useMetasploitStore } from '@/lib/metasploit-store';

interface MetasploitSession {
  id: number;
  type: 'meterpreter' | 'shell' | 'unknown';
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
  status: 'active' | 'closed' | 'dead';
  platform?: string;
  arch?: string;
  user?: string;
  computer?: string;
  os?: string;
  timestamp: number;
  lastActivity?: number;
  activityCount?: number;
  lastCommand?: string;
  exploitUsed?: string;
  privilegeLevel?: 'user' | 'admin' | 'system' | 'unknown';
  compromiseTime?: number;
}

interface SessionManagerProps {
  sessions: MetasploitSession[];
  onSessionInteract: (sessionId: number) => void;
  onSessionKill: (sessionId: number) => void;
  onRefreshSessions: () => void;
  isLoading?: boolean;
  isActive?: boolean;
}

export function SessionManager({ 
  sessions, 
  onSessionInteract, 
  onSessionKill, 
  onRefreshSessions,
  isLoading = false,
  isActive = true,
}: SessionManagerProps) {
  const [showDetails, setShowDetails] = useState<number | null>(null);
  const [realTimeSessions, setRealTimeSessions] = useState<MetasploitSession[]>(sessions);
  
  const {
    addSessionActivity,
    credentials,
    evidenceFiles,
  } = useMetasploitStore();
  const { showToast } = useToast();

  // Keep the panel projection synchronized with explicit refreshes and other
  // store updates without issuing any command to the persistent console.
  useEffect(() => {
    setRealTimeSessions(sessions);
  }, [sessions]);

  // Do not poll the persistent console from this view. Polling sends commands
  // into the user's interactive MSF transcript, which makes commands appear to
  // be typed by themselves and can race with real keyboard input. Refresh is an
  // explicit user action; the persistent console remains a true Linux-like
  // interactive session.

  const parseSessionsFromOutput = (output: string): MetasploitSession[] => {
    const sessionList: MetasploitSession[] = [];
    const lines = output.split('\n');
    let inSessionsSection = false;

    for (const line of lines) {
      if (line.includes('Active sessions') || line.includes('Sessions')) {
        inSessionsSection = true;
        continue;
      }

      if (inSessionsSection && line.includes('===')) {
        continue;
      }

      if (inSessionsSection && line.trim()) {
        const match = line.match(/^\s*(\d+)\s+(\w+)\s+([^@]+)@\s*([^\s]+)\s+([^-]+)->\s*(.+)$/);
        if (match) {
          const [, id, type, userInfo, computer, tunnel] = match;
          const [localPart, remotePart] = tunnel.split(' -> ');
          const [localIp, localPort] = localPart.split(':');
          const [remoteIp, remotePort] = remotePart.split(':');
          
          sessionList.push({
            id: parseInt(id),
            type: type.toLowerCase().includes('meterpreter') ? 'meterpreter' : 'shell',
            localIp: localIp.trim(),
            localPort: parseInt(localPort) || 0,
            remoteIp: remoteIp.trim(),
            remotePort: parseInt(remotePort) || 0,
            status: 'active',
            platform: type,
            user: userInfo.trim(),
            computer: computer.trim(),
            timestamp: Date.now(),
            lastActivity: Date.now(),
            privilegeLevel: userInfo.includes('SYSTEM') ? 'system' : 
                          userInfo.includes('Administrator') ? 'admin' : 'user'
          });
        }
      }

      if (inSessionsSection && line.trim() === '') {
        break;
      }
    }

    return sessionList;
  };

  // These actions dispatch real commands into the selected MSF session. The
  // persistent command API acknowledges the write, while command output is
  // streamed to the Console; never manufacture evidence or claim success
  // before the operator reviews that output.
  const dispatchSessionCommand = async (sessionId: number, command: string, label: string): Promise<boolean> => {
    if (!window.electron) return false;

    try {
      const interaction = await window.electron.msfConsoleSessions('interact', sessionId);
      if (!interaction.success) throw new Error(interaction.error || 'Could not select the session');

      const result = await window.electron.msfConsoleCommand(command);
      if (!result.success) throw new Error(result.error || `Metasploit rejected ${command}`);

      addSessionActivity(sessionId, { command });
      showToast(`${label} command sent to session ${sessionId}; review the Console output`, 'info');
      return true;
    } catch (error) {
      console.error(`${label} failed:`, error);
      showToast(`${label} failed for session ${sessionId}: ${String(error)}`, 'error');
      return false;
    }
  };

  const handleScreenshot = (sessionId: number) => dispatchSessionCommand(sessionId, 'screenshot', 'Screenshot');
  const handleSysinfo = (sessionId: number) => dispatchSessionCommand(sessionId, 'sysinfo', 'System info');
  const handlePrivilegeEscalation = (sessionId: number) => dispatchSessionCommand(sessionId, 'getsystem', 'Privilege escalation');

  const handleCredentialHarvesting = async (sessionId: number) => {
    for (const command of ['hashdump', 'load kiwi', 'creds_all']) {
      const sent = await dispatchSessionCommand(sessionId, command, `Credential command ${command}`);
      if (!sent) return;
    }
  };

  const getPrivilegeBadge = (privilegeLevel?: string) => {
    switch (privilegeLevel) {
      case 'system':
        return <Badge className="bg-red-500 text-white">SYSTEM</Badge>;
      case 'admin':
        return <Badge className="bg-orange-500 text-white">ADMIN</Badge>;
      case 'user':
        return <Badge variant="secondary">USER</Badge>;
      default:
        return <Badge variant="outline">UNKNOWN</Badge>;
    }
  };

  const getSessionTypeIcon = (type: string) => {
    switch (type) {
      case 'meterpreter':
        return <Zap className="w-4 h-4 text-blue-500" />;
      case 'shell':
        return <Terminal className="w-4 h-4 text-green-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
    }
  };

  const getSessionEvidence = (sessionId: number) => {
    return evidenceFiles.filter(e => e.sessionId === sessionId);
  };

  const getSessionCredentials = (sessionId: number) => {
    return credentials.filter(c => c.sessionId === sessionId);
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="h-12 bg-muted/30 border-b border-border flex items-center px-4 gap-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-bold text-foreground">Session Manager</h3>
          <Badge variant="outline" className="text-xs">
            {realTimeSessions.filter(s => s.status === 'active').length} Active
          </Badge>
        </div>
        
        <div className="flex items-center gap-2 ml-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefreshSessions}
            disabled={isLoading}
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {realTimeSessions.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Users className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No Active Sessions</h3>
              <p className="text-muted-foreground">
                Exploit targets to establish sessions and manage compromised hosts.
              </p>
            </div>
          </div>
        ) : (
          <Tabs defaultValue="sessions" className="h-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
              <TabsTrigger value="credentials">Credentials</TabsTrigger>
            </TabsList>
            
            <TabsContent value="sessions" className="h-full">
              <ScrollArea className="h-full p-4">
                <div className="space-y-4">
                  {realTimeSessions.map((session) => (
                    <Card key={session.id} className="relative">
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {getSessionTypeIcon(session.type)}
                            <div>
                              <CardTitle className="text-lg">
                                Session {session.id} - {session.remoteIp}
                              </CardTitle>
                              <CardDescription>
                                {session.user}@{session.computer} • {session.platform}
                              </CardDescription>
                            </div>
                            {getPrivilegeBadge(session.privilegeLevel)}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setShowDetails(showDetails === session.id ? null : session.id)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => onSessionInteract(session.id)}
                            >
                              <Terminal className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => onSessionKill(session.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </CardHeader>
                      
                      {showDetails === session.id && (
                        <CardContent>
                          <div className="space-y-4">
                            {/* Session Info */}
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="font-medium">Local:</span> {session.localIp}:{session.localPort}
                              </div>
                              <div>
                                <span className="font-medium">Remote:</span> {session.remoteIp}:{session.remotePort}
                              </div>
                              <div>
                                <span className="font-medium">Type:</span> {session.type}
                              </div>
                              <div>
                                <span className="font-medium">Status:</span> 
                                <Badge variant={session.status === 'active' ? 'default' : 'secondary'} className="ml-2">
                                  {session.status}
                                </Badge>
                              </div>
                              {session.exploitUsed && (
                                <div className="col-span-2">
                                  <span className="font-medium">Exploit Used:</span> {session.exploitUsed}
                                </div>
                              )}
                              {session.compromiseTime && (
                                <div className="col-span-2">
                                  <span className="font-medium">Compromised:</span> {new Date(session.compromiseTime).toLocaleString()}
                                </div>
                              )}
                            </div>
                            
                            {/* Quick Actions */}
                            <div className="border-t pt-4">
                              <h4 className="font-medium mb-3">Post-Exploitation Actions</h4>
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleScreenshot(session.id)}
                                  className="flex items-center gap-2"
                                >
                                  <Camera className="w-4 h-4" />
                                  Screenshot
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleSysinfo(session.id)}
                                  className="flex items-center gap-2"
                                >
                                  <Cpu className="w-4 h-4" />
                                  System Info
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handlePrivilegeEscalation(session.id)}
                                  className="flex items-center gap-2"
                                >
                                  <ArrowUp className="w-4 h-4" />
                                  Escalate
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleCredentialHarvesting(session.id)}
                                  className="flex items-center gap-2"
                                >
                                  <Key className="w-4 h-4" />
                                  Harvest Creds
                                </Button>
                              </div>
                            </div>
                            
                            {/* Evidence & Credentials Summary */}
                            <div className="border-t pt-4">
                              <div className="grid grid-cols-3 gap-4 text-center">
                                <div>
                                  <div className="text-2xl font-bold text-blue-600">
                                    {getSessionEvidence(session.id).length}
                                  </div>
                                  <div className="text-xs text-muted-foreground">Evidence Files</div>
                                </div>
                                <div>
                                  <div className="text-2xl font-bold text-green-600">
                                    {getSessionCredentials(session.id).length}
                                  </div>
                                  <div className="text-xs text-muted-foreground">Credentials</div>
                                </div>
                                <div>
                                    <div className="text-2xl font-bold text-purple-600">{session.activityCount || 0}</div>
                                    <div className="text-xs text-muted-foreground">Commands</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      )}
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
            
            <TabsContent value="evidence" className="h-full">
              <ScrollArea className="h-full p-4">
                <div className="space-y-4">
                  {evidenceFiles.length === 0 ? (
                    <div className="text-center py-8">
                      <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">No evidence collected yet.</p>
                    </div>
                  ) : (
                    evidenceFiles.map((evidence) => (
                      <Card key={evidence.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <FileText className="w-5 h-5 text-blue-500" />
                              <div>
                                <div className="font-medium">{evidence.filename}</div>
                                <div className="text-sm text-muted-foreground">
                                  Session {evidence.sessionId} • {evidence.type} • {new Date(evidence.timestamp).toLocaleString()}
                                </div>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
            
            <TabsContent value="credentials" className="h-full">
              <ScrollArea className="h-full p-4">
                <div className="space-y-4">
                  {credentials.length === 0 ? (
                    <div className="text-center py-8">
                      <Key className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                      <p className="text-muted-foreground">No credentials harvested yet.</p>
                    </div>
                  ) : (
                    credentials.map((cred) => (
                      <Card key={cred.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Key className="w-5 h-5 text-green-500" />
                              <div>
                                <div className="font-medium">{cred.username}</div>
                                <div className="text-sm text-muted-foreground">
                                  {cred.domain && `${cred.domain}\\`}
                                  Session {cred.sessionId} • {cred.type} • {cred.source}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <Badge variant="outline">{cred.type}</Badge>
                              <div className="text-xs text-muted-foreground mt-1">
                                {new Date(cred.timestamp).toLocaleString()}
                              </div>
                            </div>
                          </div>
                          {cred.hash && (
                            <div className="mt-2 p-2 bg-muted/30 rounded font-mono text-xs break-all">
                              {cred.hash}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
