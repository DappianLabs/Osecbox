import React from 'react';
import { Target, Shield, Wrench, FileText } from 'lucide-react';

export interface MetasploitModule {
  name: string;
  fullPath: string;
  type: 'exploit' | 'auxiliary' | 'post' | 'payload';
  rank?: string;
  description?: string;
  disclosureDate?: string;
}

interface ModuleCardProps {
  module: MetasploitModule;
  onClick: () => void;
}

export function ModuleCard({ module, onClick }: ModuleCardProps) {
  const getIcon = () => {
    switch (module.type) {
      case 'exploit':
        return <Target className="w-5 h-5" />;
      case 'auxiliary':
        return <Wrench className="w-5 h-5" />;
      case 'post':
        return <FileText className="w-5 h-5" />;
      default:
        return <Shield className="w-5 h-5" />;
    }
  };

  const getRankColor = (rank?: string) => {
    if (!rank) return 'text-gray-400';
    const r = rank.toLowerCase();
    if (r.includes('excellent')) return 'text-green-500';
    if (r.includes('great')) return 'text-blue-500';
    if (r.includes('good')) return 'text-yellow-500';
    return 'text-gray-400';
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="ui-card-interactive group w-full bg-card border border-border rounded-lg p-4 text-left hover:border-primary/50 hover:shadow-lg cursor-pointer"
      aria-label={`Open ${module.name}`}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 bg-primary/10 rounded-lg text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
          {getIcon()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-foreground truncate group-hover:text-primary transition-colors">
            {module.name}
          </h3>
          <p className="text-xs text-muted-foreground font-mono mt-1 truncate">
            {module.fullPath}
          </p>
          {module.description && (
            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
              {module.description}
            </p>
          )}
          <div className="flex items-center gap-3 mt-2">
            {module.rank && (
              <span className={`text-xs font-bold ${getRankColor(module.rank)}`}>
                {module.rank}
              </span>
            )}
            {module.disclosureDate && (
              <span className="text-xs text-muted-foreground">
                {module.disclosureDate}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
