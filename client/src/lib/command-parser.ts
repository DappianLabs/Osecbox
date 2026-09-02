// Generic command output parser for displaying results in card format

export interface CommandResult {
  command: string;
  type: 'nslookup' | 'ipconfig' | 'arp' | 'netstat' | 'ping' | 'route' | 'generic';
  data: any;
  rawOutput: string;
}

export function parseCommandOutput(command: string, output: string): CommandResult | null {
  const cmd = command.toLowerCase().trim();
  
  // Detect command type
  if (cmd.startsWith('nslookup')) {
    return parseNslookup(command, output);
  } else if (cmd.includes('ipconfig') || cmd.includes('ip a')) {
    return parseIpconfig(command, output);
  } else if (cmd.includes('arp')) {
    return parseArp(command, output);
  } else if (cmd.includes('netstat')) {
    return parseNetstat(command, output);
  } else if (cmd.includes('ping')) {
    return parsePing(command, output);
  } else if (cmd.includes('route')) {
    return parseRoute(command, output);
  }
  
  return null;
}

function parseNslookup(command: string, output: string): CommandResult {
  const lines = output.split('\n').map(l => l.trim()).filter(l => l);
  const data: any = {
    servers: [],
    addresses: [],
    names: []
  };
  
  for (const line of lines) {
    if (line.startsWith('Server:')) {
      data.servers.push(line.replace('Server:', '').trim());
    } else if (line.startsWith('Address:')) {
      const addr = line.replace('Address:', '').trim();
      if (addr) data.addresses.push(addr);
    } else if (line.startsWith('Name:')) {
      data.names.push(line.replace('Name:', '').trim());
    } else if (line.includes('Non-authoritative')) {
      data.nonAuthoritative = true;
    }
  }
  
  return {
    command,
    type: 'nslookup',
    data,
    rawOutput: output
  };
}

function parseIpconfig(command: string, output: string): CommandResult {
  const lines = output.split('\n');
  const interfaces: any[] = [];
  let currentInterface: any = null;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // New interface
    if (line && !line.startsWith(' ') && line.includes(':')) {
      if (currentInterface) interfaces.push(currentInterface);
      currentInterface = {
        name: trimmed.replace(':', ''),
        properties: []
      };
    } else if (currentInterface && trimmed) {
      const match = trimmed.match(/^(.+?)[\s.]+:\s*(.+)$/);
      if (match) {
        currentInterface.properties.push({
          key: match[1].trim(),
          value: match[2].trim()
        });
      }
    }
  }
  
  if (currentInterface) interfaces.push(currentInterface);
  
  return {
    command,
    type: 'ipconfig',
    data: { interfaces },
    rawOutput: output
  };
}

function parseArp(command: string, output: string): CommandResult {
  const lines = output.split('\n').filter(l => l.trim());
  const entries: any[] = [];
  
  for (const line of lines) {
    // Match IP and MAC patterns
    const ipMatch = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    const macMatch = line.match(/([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/);
    
    if (ipMatch && macMatch) {
      entries.push({
        ip: ipMatch[0],
        mac: macMatch[0],
        type: line.includes('dynamic') ? 'dynamic' : 'static'
      });
    }
  }
  
  return {
    command,
    type: 'arp',
    data: { entries },
    rawOutput: output
  };
}

function parseNetstat(command: string, output: string): CommandResult {
  const lines = output.split('\n').filter(l => l.trim());
  const connections: any[] = [];
  
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 4 && (parts[0] === 'TCP' || parts[0] === 'UDP')) {
      connections.push({
        protocol: parts[0],
        local: parts[1],
        remote: parts[2],
        state: parts[3]
      });
    }
  }
  
  return {
    command,
    type: 'netstat',
    data: { connections: connections.slice(0, 50) }, // Limit to 50
    rawOutput: output
  };
}

function parsePing(command: string, output: string): CommandResult {
  const lines = output.split('\n');
  const data: any = {
    host: '',
    packets: { sent: 0, received: 0, lost: 0 },
    times: []
  };
  
  for (const line of lines) {
    if (line.includes('Pinging')) {
      const match = line.match(/Pinging (.+?) \[?(.+?)\]?/);
      if (match) data.host = match[1];
    } else if (line.includes('time=')) {
      const timeMatch = line.match(/time[=<](\d+)/);
      if (timeMatch) data.times.push(parseInt(timeMatch[1]));
    } else if (line.includes('Packets:')) {
      const sentMatch = line.match(/Sent = (\d+)/);
      const recvMatch = line.match(/Received = (\d+)/);
      const lostMatch = line.match(/Lost = (\d+)/);
      if (sentMatch) data.packets.sent = parseInt(sentMatch[1]);
      if (recvMatch) data.packets.received = parseInt(recvMatch[1]);
      if (lostMatch) data.packets.lost = parseInt(lostMatch[1]);
    }
  }
  
  return {
    command,
    type: 'ping',
    data,
    rawOutput: output
  };
}

function parseRoute(command: string, output: string): CommandResult {
  const lines = output.split('\n').filter(l => l.trim());
  const routes: any[] = [];
  
  for (const line of lines) {
    const ipMatch = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g);
    if (ipMatch && ipMatch.length >= 2) {
      routes.push({
        destination: ipMatch[0],
        gateway: ipMatch[1]
      });
    }
  }
  
  return {
    command,
    type: 'route',
    data: { routes },
    rawOutput: output
  };
}
