import React from 'react';
import { CommandBlock } from './CommandBlock';

interface MarkdownMessageProps {
  content: string;
  onRunCommand?: (command: string) => void;
  commandDestination?: string;
}

// Detect if a code block contains a command
function isCommand(code: string, language?: string): boolean {
  const trimmed = code.trim();
  
  // Check language hints
  if (language && ['bash', 'sh', 'shell', 'zsh', 'terminal', 'console'].includes(language.toLowerCase())) {
    return true;
  }
  
  // Common command patterns
  const commandPatterns = [
    /^(sudo\s+)?[a-z0-9_-]+\s+/i,  // starts with command
    /^nmap\s+/i,
    /^gobuster\s+/i,
    /^nikto\s+/i,
    /^nuclei\s+/i,
    /^ffuf\s+/i,
    /^wfuzz\s+/i,
    /^sqlmap\s+/i,
    /^hydra\s+/i,
    /^john\s+/i,
    /^hashcat\s+/i,
    /^msfconsole/i,
    /^msfvenom\s+/i,
    /^searchsploit\s+/i,
    /^curl\s+/i,
    /^wget\s+/i,
    /^ssh\s+/i,
    /^nc\s+/i,
    /^netcat\s+/i,
    /^python[23]?\s+/i,
    /^perl\s+/i,
    /^ruby\s+/i,
    /^php\s+/i,
    /^gcc\s+/i,
    /^g\+\+\s+/i,
    /^make\s+/i,
    /^chmod\s+/i,
    /^chown\s+/i,
    /^find\s+/i,
    /^grep\s+/i,
    /^awk\s+/i,
    /^sed\s+/i,
    /^cat\s+/i,
    /^ls\s+/i,
    /^cd\s+/i,
    /^pwd/i,
    /^whoami/i,
    /^id\s*/i,
    /^uname\s+/i,
    /^ps\s+/i,
    /^netstat\s+/i,
    /^ss\s+/i,
    /^ip\s+/i,
    /^ifconfig/i,
    /^route\s+/i,
    /^iptables\s+/i,
    /^tcpdump\s+/i,
    /^wireshark/i,
    /^git\s+/i,
    /^docker\s+/i,
    /^kubectl\s+/i,
  ];
  
  return commandPatterns.some(pattern => pattern.test(trimmed));
}

// Parse markdown-style content
function parseMarkdown(content: string): Array<{ type: 'text' | 'code'; content: string; language?: string }> {
  const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
  
  // Match code blocks with optional language
  const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  
  while ((match = codeBlockRegex.exec(content)) !== null) {
    // Add text before code block
    if (match.index > lastIndex) {
      const textContent = content.slice(lastIndex, match.index);
      if (textContent.trim()) {
        parts.push({ type: 'text', content: textContent });
      }
    }
    
    // Add code block
    const language = match[1];
    const code = match[2].trim();
    if (code) {
      parts.push({ type: 'code', content: code, language });
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex);
    // During streaming, the closing fence may not have arrived yet. Treat an
    // unmatched fence as a code block so command presentation does not jump
    // from plain text to a terminal card when the response completes.
    const openFence = textContent.match(/(?:^|\n)```([\w-]+)?(?:\r?\n|$)/);
    if (openFence && openFence.index !== undefined) {
      const fenceStart = openFence.index + (openFence[0].startsWith('\n') ? 1 : 0);
      const beforeFence = textContent.slice(0, fenceStart);
      if (beforeFence.trim()) {
        parts.push({ type: 'text', content: beforeFence });
      }

      const codeStart = openFence.index + openFence[0].length;
      parts.push({
        type: 'code',
        content: textContent.slice(codeStart).trim(),
        language: openFence[1],
      });
    } else if (textContent.trim()) {
      parts.push({ type: 'text', content: textContent });
    }
  }
  
  // If no code blocks found, return entire content as text
  if (parts.length === 0) {
    parts.push({ type: 'text', content });
  }
  
  return parts;
}

// Format inline markdown without losing formatting when inline code is present.
// The old implementation split every line into an array first, then only ran
// the bold parser when the result was still a string. That made **bold** render
// literally in almost every normal line.
function formatInlineText(text: string, keyPrefix: string): React.ReactNode {
  const nodes: React.ReactNode[] = [];
  const inlineToken = /(`[^`]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let tokenIndex = 0;

  while ((match = inlineToken.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${tokenIndex++}`;
    if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-gray-800 px-1 py-0.5 text-xs font-mono text-foreground">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith('**') || token.startsWith('__')) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      nodes.push(
        <em key={key} className="italic text-foreground/90">
          {token.slice(1, -1)}
        </em>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : text;
}

// Format text with basic markdown support
function formatText(text: string, keyPrefix: string): React.ReactNode {
  // Split by lines to handle different formatting
  const lines = text.split('\n');
  
  return lines.map((line, idx) => {
    // Headers
    if (line.startsWith('### ')) {
      return <h3 key={idx} className="mt-3 mb-1 text-base font-semibold text-foreground">{formatInlineText(line.slice(4), `${keyPrefix}-${idx}`)}</h3>;
    }
    if (line.startsWith('## ')) {
      return <h2 key={idx} className="mt-4 mb-2 text-lg font-semibold text-foreground">{formatInlineText(line.slice(3), `${keyPrefix}-${idx}`)}</h2>;
    }
    if (line.startsWith('# ')) {
      return <h1 key={idx} className="mt-4 mb-2 text-xl font-bold text-foreground">{formatInlineText(line.slice(2), `${keyPrefix}-${idx}`)}</h1>;
    }
    
    // Lists
    if (line.match(/^[\*\-]\s+/)) {
      return <div key={idx} className="ml-4 list-item">{formatInlineText(line.slice(2), `${keyPrefix}-${idx}`)}</div>;
    }
    if (line.match(/^\d+\.\s+/)) {
      return <div key={idx} className="ml-4 list-item">{formatInlineText(line.replace(/^\d+\.\s+/, ''), `${keyPrefix}-${idx}`)}</div>;
    }

    return <div key={idx}>{formatInlineText(line, `${keyPrefix}-${idx}`)}</div>;
  });
}

export const MarkdownMessage = React.memo(function MarkdownMessage({ content, onRunCommand, commandDestination }: MarkdownMessageProps) {
  const parts = parseMarkdown(content);
  
  return (
    <div className="space-y-2 text-[13px] leading-6 text-slate-100">
      {parts.map((part, idx) => {
        if (part.type === 'code') {
          // Check if it's a command
          if (isCommand(part.content, part.language)) {
            return (
              <CommandBlock
                key={idx}
                command={part.content}
                language={part.language || 'bash'}
                onRun={onRunCommand}
                destination={commandDestination}
              />
            );
          } else {
            // Regular code block (not a command)
            return (
              <div key={idx} className="rounded-lg overflow-hidden border border-gray-700 my-2">
                <div className="bg-gray-800 px-3 py-1.5 border-b border-gray-700">
                  <span className="text-[10px] text-gray-400 font-mono">{part.language || 'code'}</span>
                </div>
                <div className="p-3 bg-black">
                  <pre className="text-gray-100 font-mono text-xs overflow-x-auto">
                    <code>{part.content}</code>
                  </pre>
                </div>
              </div>
            );
          }
        } else {
          return (
            <div key={idx} className="whitespace-pre-wrap">
              {formatText(part.content, `message-${idx}`)}
            </div>
          );
        }
      })}
    </div>
  );
});
