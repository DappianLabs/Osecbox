import { create } from 'zustand';

interface ToolStatus {
  name: string;
  installed: boolean;
  version?: string;
  path?: string;
}

interface ToolCheckState {
  tools: Record<string, ToolStatus>;
  loading: boolean;
  checkTool: (tool: string) => Promise<ToolStatus>;
  checkAllTools: () => Promise<void>;
  showInstallDialog: (tool: string) => void;
  installDialogTool: string | null;
  closeInstallDialog: () => void;
}

export const useToolCheckStore = create<ToolCheckState>((set, get) => ({
  tools: {},
  loading: false,
  installDialogTool: null,

  checkTool: async (tool: string) => {
    const result = await window.electron?.checkToolInstalled(tool);
    
    const status: ToolStatus = {
      name: tool,
      installed: result?.installed || false,
      version: result?.version,
      path: result?.path,
    };

    set((state) => ({
      tools: {
        ...state.tools,
        [tool]: status,
      },
    }));

    return status;
  },

  checkAllTools: async () => {
    set({ loading: true });
    
    const tools = [
      'nmap', 'subfinder', 'amass', 'assetfinder', 'ffuf',
      'sublist3r',
      'nikto', 'nuclei', 'gobuster', 'msfconsole', 'msfvenom',
    ];
    
    await Promise.all(tools.map(tool => get().checkTool(tool)));
    
    set({ loading: false });
  },

  showInstallDialog: (tool: string) => {
    set({ installDialogTool: tool });
  },

  closeInstallDialog: () => {
    set({ installDialogTool: null });
  },
}));
