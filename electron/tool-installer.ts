export interface InstallInstructions {
  tool: string;
  distro: string;
  packageManager: string;
  command: string;
  notes?: string;
}

export type InstallRuntime = 'wsl2' | 'linux' | 'darwin';

export interface InstallScript {
  runtime: InstallRuntime;
  shell: 'bash';
  distro: string;
  tools: string[];
  script: string;
  instructions: InstallInstructions[];
}

/** Keep the installer catalog aligned with every external binary OsecBox can check. */
export const SUPPORTED_INSTALL_TOOLS = [
  'nmap', 'subfinder', 'sublist3r', 'amass', 'assetfinder', 'nikto', 'nuclei',
  'gobuster', 'sqlmap', 'ffuf', 'dirb', 'msfconsole', 'msfvenom',
  'python3', 'python', 'ssh',
  'nc', 'ncat', 'socat', 'pwncat-cs', 'sliver-server',
  'chisel', 'ligolo-ng', 'sshuttle', 'ngrok',
] as const;

const installToolNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export class ToolInstaller {
  getInstallCommand(tool: string, distro: string): InstallInstructions {
    const normalizedDistro = String(distro || '').trim().toLowerCase();
    
    // Map similar distros
    const distroMap: Record<string, string> = {
      'ubuntu': 'ubuntu',
      'ubuntu-18.04': 'ubuntu',
      'ubuntu-20.04': 'ubuntu',
      'ubuntu-22.04': 'ubuntu',
      'ubuntu-24.04': 'ubuntu',
      'debian': 'debian',
      'debian-10': 'debian',
      'debian-11': 'debian',
      'debian-12': 'debian',
      'kali': 'kali',
      'kali-linux': 'kali',
      'parrot': 'kali',
      'parrotos': 'kali',
      'mint': 'ubuntu',
      'pop': 'ubuntu',
      'arch': 'arch',
      'manjaro': 'arch',
      'endeavouros': 'arch',
      'fedora': 'fedora',
      'rhel': 'fedora',
      'centos': 'fedora',
      'rocky': 'fedora',
      'alpine': 'alpine',
      'darwin': 'darwin',
      'win32': 'win32',
    };

    const mappedDistro = distroMap[normalizedDistro];
    if (!mappedDistro) {
      throw new Error(`Unsupported distro: ${distro || '(empty)'}`);
    }
    
    const commands: Record<string, Record<string, InstallInstructions>> = {
      nmap: {
        ubuntu: {
          tool: 'nmap',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y nmap',
        },
        debian: {
          tool: 'nmap',
          distro: 'debian',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y nmap',
        },
        kali: {
          tool: 'nmap',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y nmap',
          notes: 'Nmap is usually pre-installed on Kali Linux',
        },
        arch: {
          tool: 'nmap',
          distro: 'arch',
          packageManager: 'pacman',
          command: 'sudo pacman -S --noconfirm nmap',
        },
        fedora: {
          tool: 'nmap',
          distro: 'fedora',
          packageManager: 'dnf',
          command: 'sudo dnf install -y nmap',
        },
        alpine: {
          tool: 'nmap',
          distro: 'alpine',
          packageManager: 'apk',
          command: 'sudo apk add nmap',
        },
        darwin: {
          tool: 'nmap',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install nmap',
          notes: 'Requires Homebrew. Install from: https://brew.sh',
        },
        win32: {
          tool: 'nmap',
          distro: 'win32',
          packageManager: 'manual',
          command: 'Download from https://nmap.org/download.html',
          notes: 'Or use Chocolatey: choco install nmap',
        },
      },
      subfinder: {
        ubuntu: {
          tool: 'subfinder',
          distro: 'ubuntu',
          packageManager: 'go',
          command: 'go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest',
          notes: 'Requires Go. Install: sudo apt install golang-go',
        },
        arch: {
          tool: 'subfinder',
          distro: 'arch',
          packageManager: 'go',
          command: 'go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest',
          notes: 'Requires Go. Install: sudo pacman -S go',
        },
        darwin: {
          tool: 'subfinder',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install subfinder',
        },
        win32: {
          tool: 'subfinder',
          distro: 'win32',
          packageManager: 'go',
          command: 'go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest',
          notes: 'Requires Go. Download from: https://go.dev/dl/',
        },
      },
      assetfinder: {
        ubuntu: {
          tool: 'assetfinder',
          distro: 'ubuntu',
          packageManager: 'go',
          command: 'go install github.com/tomnomnom/assetfinder@latest',
          notes: 'Requires Go. Install: sudo apt install golang-go',
        },
        arch: {
          tool: 'assetfinder',
          distro: 'arch',
          packageManager: 'go',
          command: 'go install github.com/tomnomnom/assetfinder@latest',
          notes: 'Requires Go. Install: sudo pacman -S go',
        },
        darwin: {
          tool: 'assetfinder',
          distro: 'darwin',
          packageManager: 'go',
          command: 'go install github.com/tomnomnom/assetfinder@latest',
          notes: 'Requires Go. Install from: https://go.dev/dl/',
        },
        win32: {
          tool: 'assetfinder',
          distro: 'win32',
          packageManager: 'go',
          command: 'go install github.com/tomnomnom/assetfinder@latest',
          notes: 'Requires Go. Install from: https://go.dev/dl/',
        },
      },
      sublist3r: {
        ubuntu: {
          tool: 'sublist3r',
          distro: 'ubuntu',
          packageManager: 'pip',
          command: 'python3 -m pip install --user sublist3r',
          notes: 'If the package is unavailable, clone https://github.com/aboul3la/Sublist3r and install its requirements.',
        },
        kali: {
          tool: 'sublist3r',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y sublist3r',
          notes: 'Sublist3r is commonly available in Kali repositories.',
        },
        arch: {
          tool: 'sublist3r',
          distro: 'arch',
          packageManager: 'pip',
          command: 'python3 -m pip install --user sublist3r',
        },
        fedora: {
          tool: 'sublist3r',
          distro: 'fedora',
          packageManager: 'pip',
          command: 'python3 -m pip install --user sublist3r',
        },
        darwin: {
          tool: 'sublist3r',
          distro: 'darwin',
          packageManager: 'pip',
          command: 'python3 -m pip install --user sublist3r',
        },
        win32: {
          tool: 'sublist3r',
          distro: 'win32',
          packageManager: 'wsl',
          command: 'wsl python3 -m pip install --user sublist3r',
          notes: 'Install and expose the sublist3r command inside the selected WSL2 distro.',
        },
      },
      amass: {
        ubuntu: {
          tool: 'amass',
          distro: 'ubuntu',
          packageManager: 'snap',
          command: 'sudo snap install amass',
          notes: 'Or use Go: go install -v github.com/owasp-amass/amass/v4/...@master',
        },
        arch: {
          tool: 'amass',
          distro: 'arch',
          packageManager: 'go',
          command: 'go install -v github.com/owasp-amass/amass/v4/...@master',
        },
        darwin: {
          tool: 'amass',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install amass',
        },
        win32: {
          tool: 'amass',
          distro: 'win32',
          packageManager: 'go',
          command: 'go install -v github.com/owasp-amass/amass/v4/...@master',
        },
      },
      nikto: {
        ubuntu: {
          tool: 'nikto',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y nikto',
        },
        kali: {
          tool: 'nikto',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y nikto',
          notes: 'Nikto is usually pre-installed on Kali Linux',
        },
        arch: {
          tool: 'nikto',
          distro: 'arch',
          packageManager: 'pacman',
          command: 'sudo pacman -S --noconfirm nikto',
        },
        darwin: {
          tool: 'nikto',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install nikto',
        },
        win32: {
          tool: 'nikto',
          distro: 'win32',
          packageManager: 'manual',
          command: 'Download from https://github.com/sullo/nikto',
          notes: 'Requires Perl. Or use WSL.',
        },
      },
      nuclei: {
        ubuntu: {
          tool: 'nuclei',
          distro: 'ubuntu',
          packageManager: 'go',
          command: 'go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest',
          notes: 'Requires Go. Install: sudo apt install golang-go',
        },
        arch: {
          tool: 'nuclei',
          distro: 'arch',
          packageManager: 'go',
          command: 'go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest',
        },
        darwin: {
          tool: 'nuclei',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install nuclei',
        },
        win32: {
          tool: 'nuclei',
          distro: 'win32',
          packageManager: 'go',
          command: 'go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest',
        },
      },
      gobuster: {
        ubuntu: {
          tool: 'gobuster',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y gobuster',
        },
        kali: {
          tool: 'gobuster',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y gobuster',
          notes: 'Gobuster is usually pre-installed on Kali Linux',
        },
        arch: {
          tool: 'gobuster',
          distro: 'arch',
          packageManager: 'go',
          command: 'go install github.com/OJ/gobuster/v3@latest',
        },
        darwin: {
          tool: 'gobuster',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install gobuster',
        },
        win32: {
          tool: 'gobuster',
          distro: 'win32',
          packageManager: 'go',
          command: 'go install github.com/OJ/gobuster/v3@latest',
        },
      },
      sqlmap: {
        ubuntu: {
          tool: 'sqlmap',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y sqlmap',
        },
        kali: {
          tool: 'sqlmap',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y sqlmap',
          notes: 'SQLMap is usually pre-installed on Kali Linux',
        },
        arch: {
          tool: 'sqlmap',
          distro: 'arch',
          packageManager: 'pacman',
          command: 'sudo pacman -S --noconfirm sqlmap',
        },
        darwin: {
          tool: 'sqlmap',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install sqlmap',
        },
        win32: {
          tool: 'sqlmap',
          distro: 'win32',
          packageManager: 'manual',
          command: 'Download from https://sqlmap.org',
          notes: 'Requires Python. Or use pip: pip install sqlmap',
        },
      },
      ffuf: {
        ubuntu: {
          tool: 'ffuf',
          distro: 'ubuntu',
          packageManager: 'go',
          command: 'go install github.com/ffuf/ffuf/v2@latest',
          notes: 'Requires Go. Install: sudo apt install golang-go',
        },
        arch: {
          tool: 'ffuf',
          distro: 'arch',
          packageManager: 'pacman',
          command: 'sudo pacman -S --noconfirm ffuf',
        },
        darwin: {
          tool: 'ffuf',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install ffuf',
        },
        win32: {
          tool: 'ffuf',
          distro: 'win32',
          packageManager: 'go',
          command: 'go install github.com/ffuf/ffuf/v2@latest',
        },
      },
      dirb: {
        ubuntu: {
          tool: 'dirb',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y dirb',
        },
        kali: {
          tool: 'dirb',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y dirb',
          notes: 'Dirb is usually pre-installed on Kali Linux',
        },
        arch: {
          tool: 'dirb',
          distro: 'arch',
          packageManager: 'aur',
          command: 'yay -S dirb',
          notes: 'Available in AUR',
        },
        darwin: {
          tool: 'dirb',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install dirb',
        },
        win32: {
          tool: 'dirb',
          distro: 'win32',
          packageManager: 'wsl',
          command: 'wsl sudo apt update && wsl sudo apt install -y dirb',
          notes: 'Best installed via WSL',
        },
      },
      python3: {
        ubuntu: {
          tool: 'python3',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y python3',
        },
        debian: {
          tool: 'python3',
          distro: 'debian',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y python3',
        },
        kali: {
          tool: 'python3',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y python3',
        },
        arch: {
          tool: 'python3',
          distro: 'arch',
          packageManager: 'pacman',
          command: 'sudo pacman -S --noconfirm python',
        },
        fedora: {
          tool: 'python3',
          distro: 'fedora',
          packageManager: 'dnf',
          command: 'sudo dnf install -y python3',
        },
        darwin: {
          tool: 'python3',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install python',
        },
        win32: {
          tool: 'python3',
          distro: 'win32',
          packageManager: 'manual',
          command: 'Download Python 3 from https://www.python.org/downloads/',
          notes: 'Enable the Python PATH option during installation.',
        },
      },
      python: {
        ubuntu: {
          tool: 'python',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y python3',
          notes: 'Ubuntu provides the interpreter as python3; OsecBox uses python3 for Linux sessions.',
        },
        debian: {
          tool: 'python',
          distro: 'debian',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y python3',
        },
        kali: {
          tool: 'python',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y python3',
        },
        arch: {
          tool: 'python',
          distro: 'arch',
          packageManager: 'pacman',
          command: 'sudo pacman -S --noconfirm python',
        },
        fedora: {
          tool: 'python',
          distro: 'fedora',
          packageManager: 'dnf',
          command: 'sudo dnf install -y python3',
        },
        darwin: {
          tool: 'python',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install python',
        },
        win32: {
          tool: 'python',
          distro: 'win32',
          packageManager: 'manual',
          command: 'Download Python 3 from https://www.python.org/downloads/',
          notes: 'Enable the Python PATH option during installation.',
        },
      },
      ssh: {
        ubuntu: {
          tool: 'ssh',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y openssh-client',
        },
        debian: {
          tool: 'ssh',
          distro: 'debian',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y openssh-client',
        },
        kali: {
          tool: 'ssh',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y openssh-client',
        },
        arch: {
          tool: 'ssh',
          distro: 'arch',
          packageManager: 'pacman',
          command: 'sudo pacman -S --noconfirm openssh',
        },
        fedora: {
          tool: 'ssh',
          distro: 'fedora',
          packageManager: 'dnf',
          command: 'sudo dnf install -y openssh-clients',
        },
        alpine: {
          tool: 'ssh',
          distro: 'alpine',
          packageManager: 'apk',
          command: 'sudo apk add openssh-client',
        },
        darwin: {
          tool: 'ssh',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install openssh',
          notes: 'macOS normally includes an OpenSSH client already.',
        },
        win32: {
          tool: 'ssh',
          distro: 'win32',
          packageManager: 'manual',
          command: 'Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0',
          notes: 'Run in an elevated PowerShell session, or use the WSL2 OpenSSH client.',
        },
      },
      msfconsole: {
        ubuntu: {
          tool: 'msfconsole',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'curl https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb > msfinstall && chmod 755 msfinstall && ./msfinstall',
          notes: 'This installs the full Metasploit Framework',
        },
        kali: {
          tool: 'msfconsole',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y metasploit-framework',
          notes: 'Metasploit is usually pre-installed on Kali Linux',
        },
        arch: {
          tool: 'msfconsole',
          distro: 'arch',
          packageManager: 'aur',
          command: 'yay -S metasploit',
          notes: 'Available in AUR',
        },
        darwin: {
          tool: 'msfconsole',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install metasploit',
        },
        win32: {
          tool: 'msfconsole',
          distro: 'win32',
          packageManager: 'wsl',
          command: 'wsl curl https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb > msfinstall && wsl chmod 755 msfinstall && wsl ./msfinstall',
          notes: 'Best installed via WSL. Or download Windows installer from https://www.metasploit.com',
        },
      },
      msfvenom: {
        ubuntu: {
          tool: 'msfvenom',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'curl https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb > msfinstall && chmod 755 msfinstall && ./msfinstall',
          notes: 'msfvenom ships with the full Metasploit Framework installation.',
        },
        kali: {
          tool: 'msfvenom',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y metasploit-framework',
          notes: 'msfvenom ships with metasploit-framework.',
        },
        arch: {
          tool: 'msfvenom',
          distro: 'arch',
          packageManager: 'aur',
          command: 'yay -S metasploit',
          notes: 'msfvenom ships with the Metasploit package. Available in AUR.',
        },
        darwin: {
          tool: 'msfvenom',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install metasploit',
          notes: 'msfvenom ships with the Metasploit formula.',
        },
        win32: {
          tool: 'msfvenom',
          distro: 'win32',
          packageManager: 'wsl',
          command: 'wsl curl https://raw.githubusercontent.com/rapid7/metasploit-omnibus/master/config/templates/metasploit-framework-wrappers/msfupdate.erb > msfinstall && wsl chmod 755 msfinstall && wsl ./msfinstall',
          notes: 'Best installed via WSL. msfvenom ships with the full Metasploit Framework.',
        },
      },

      // ===== Foothold / Listener tools =====
      nc: {
        ubuntu: {
          tool: 'nc',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y netcat-openbsd',
          notes: 'Provides the nc command used by the WSL/Linux listener flow.',
        },
        debian: {
          tool: 'nc',
          distro: 'debian',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y netcat-openbsd',
        },
        kali: {
          tool: 'nc',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y netcat-openbsd',
        },
        arch: {
          tool: 'nc',
          distro: 'arch',
          packageManager: 'pacman',
          command: 'sudo pacman -S --noconfirm openbsd-netcat',
        },
        fedora: {
          tool: 'nc',
          distro: 'fedora',
          packageManager: 'dnf',
          command: 'sudo dnf install -y nmap-ncat',
          notes: 'Fedora may expose the installed binary as ncat; OsecBox will preflight both nc and ncat.',
        },
        darwin: {
          tool: 'nc',
          distro: 'darwin',
          packageManager: 'builtin',
          command: 'The nc command is included with macOS.',
        },
        win32: {
          tool: 'nc',
          distro: 'win32',
          packageManager: 'wsl',
          command: 'wsl sudo apt update && wsl sudo apt install -y netcat-openbsd',
          notes: 'Install in the selected WSL2 distro; OsecBox executes Linux listeners there.',
        },
      },
      ncat: {
        ubuntu: {
          tool: 'ncat',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y ncat',
          notes: 'Ncat ships with the nmap package: sudo apt install -y nmap',
        },
        kali: {
          tool: 'ncat',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y nmap',
          notes: 'Ncat is included with nmap and usually pre-installed on Kali',
        },
        arch: {
          tool: 'ncat',
          distro: 'arch',
          packageManager: 'pacman',
          command: 'sudo pacman -S --noconfirm nmap',
          notes: 'Ncat ships with the nmap package',
        },
        fedora: {
          tool: 'ncat',
          distro: 'fedora',
          packageManager: 'dnf',
          command: 'sudo dnf install -y nmap-ncat',
        },
        darwin: {
          tool: 'ncat',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install nmap',
          notes: 'Ncat ships with the nmap formula',
        },
        win32: {
          tool: 'ncat',
          distro: 'win32',
          packageManager: 'manual',
          command: 'Download nmap (includes Ncat) from https://nmap.org/download.html',
          notes: 'Or use Chocolatey: choco install nmap. Best run via WSL.',
        },
      },
      socat: {
        ubuntu: {
          tool: 'socat',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y socat',
        },
        kali: {
          tool: 'socat',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y socat',
          notes: 'Usually pre-installed on Kali Linux',
        },
        arch: {
          tool: 'socat',
          distro: 'arch',
          packageManager: 'pacman',
          command: 'sudo pacman -S --noconfirm socat',
        },
        fedora: {
          tool: 'socat',
          distro: 'fedora',
          packageManager: 'dnf',
          command: 'sudo dnf install -y socat',
        },
        darwin: {
          tool: 'socat',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install socat',
        },
        win32: {
          tool: 'socat',
          distro: 'win32',
          packageManager: 'wsl',
          command: 'wsl sudo apt update && wsl sudo apt install -y socat',
          notes: 'Best installed via WSL',
        },
      },
      'pwncat-cs': {
        ubuntu: {
          tool: 'pwncat-cs',
          distro: 'ubuntu',
          packageManager: 'pip',
          command: 'pip3 install pwncat-cs',
          notes: 'Requires Python 3.9+. Or: pipx install pwncat-cs',
        },
        kali: {
          tool: 'pwncat-cs',
          distro: 'kali',
          packageManager: 'pip',
          command: 'pip3 install pwncat-cs',
          notes: 'Requires Python 3.9+. Or: pipx install pwncat-cs',
        },
        arch: {
          tool: 'pwncat-cs',
          distro: 'arch',
          packageManager: 'pip',
          command: 'pipx install pwncat-cs',
        },
        darwin: {
          tool: 'pwncat-cs',
          distro: 'darwin',
          packageManager: 'pip',
          command: 'pipx install pwncat-cs',
        },
        win32: {
          tool: 'pwncat-cs',
          distro: 'win32',
          packageManager: 'wsl',
          command: 'wsl pip3 install pwncat-cs',
          notes: 'Best run via WSL (Linux-focused tool)',
        },
      },
      'sliver-server': {
        ubuntu: {
          tool: 'sliver-server',
          distro: 'ubuntu',
          packageManager: 'script',
          command: 'curl https://sliver.sh/install | sudo bash',
          notes: 'Installs the Sliver C2 server and client',
        },
        kali: {
          tool: 'sliver-server',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y sliver',
          notes: 'Sliver is packaged in Kali. Or use: curl https://sliver.sh/install | sudo bash',
        },
        arch: {
          tool: 'sliver-server',
          distro: 'arch',
          packageManager: 'script',
          command: 'curl https://sliver.sh/install | sudo bash',
        },
        darwin: {
          tool: 'sliver-server',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install sliver',
        },
        win32: {
          tool: 'sliver-server',
          distro: 'win32',
          packageManager: 'manual',
          command: 'Download from https://github.com/BishopFox/sliver/releases',
          notes: 'Or run the server via WSL',
        },
      },

      // ===== Tunneling / Pivoting tools =====
      chisel: {
        ubuntu: {
          tool: 'chisel',
          distro: 'ubuntu',
          packageManager: 'go',
          command: 'go install github.com/jpillora/chisel@latest',
          notes: 'Requires Go. Or download a binary from https://github.com/jpillora/chisel/releases',
        },
        kali: {
          tool: 'chisel',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y chisel',
          notes: 'Or: go install github.com/jpillora/chisel@latest',
        },
        arch: {
          tool: 'chisel',
          distro: 'arch',
          packageManager: 'go',
          command: 'go install github.com/jpillora/chisel@latest',
        },
        darwin: {
          tool: 'chisel',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install chisel',
        },
        win32: {
          tool: 'chisel',
          distro: 'win32',
          packageManager: 'go',
          command: 'go install github.com/jpillora/chisel@latest',
          notes: 'Or download a Windows binary from https://github.com/jpillora/chisel/releases',
        },
      },
      'ligolo-ng': {
        ubuntu: {
          tool: 'ligolo-ng',
          distro: 'ubuntu',
          packageManager: 'go',
          command: 'GOBIN="$HOME/go/bin" go install github.com/nicocha30/ligolo-ng/cmd/proxy@latest && ln -sf "$HOME/go/bin/proxy" "$HOME/go/bin/ligolo-ng"',
          notes: 'Requires Go. The symlink keeps the installed proxy name aligned with OsecBox’s ligolo-ng command.',
        },
        kali: {
          tool: 'ligolo-ng',
          distro: 'kali',
          packageManager: 'go',
          command: 'GOBIN="$HOME/go/bin" go install github.com/nicocha30/ligolo-ng/cmd/proxy@latest && ln -sf "$HOME/go/bin/proxy" "$HOME/go/bin/ligolo-ng"',
          notes: 'Requires Go. The symlink keeps the installed proxy name aligned with OsecBox’s ligolo-ng command.',
        },
        arch: {
          tool: 'ligolo-ng',
          distro: 'arch',
          packageManager: 'go',
          command: 'GOBIN="$HOME/go/bin" go install github.com/nicocha30/ligolo-ng/cmd/proxy@latest && ln -sf "$HOME/go/bin/proxy" "$HOME/go/bin/ligolo-ng"',
        },
        darwin: {
          tool: 'ligolo-ng',
          distro: 'darwin',
          packageManager: 'go',
          command: 'GOBIN="$HOME/go/bin" go install github.com/nicocha30/ligolo-ng/cmd/proxy@latest && ln -sf "$HOME/go/bin/proxy" "$HOME/go/bin/ligolo-ng"',
        },
        win32: {
          tool: 'ligolo-ng',
          distro: 'win32',
          packageManager: 'manual',
          command: 'Download from https://github.com/nicocha30/ligolo-ng/releases',
          notes: 'Or: go install github.com/nicocha30/ligolo-ng/cmd/proxy@latest',
        },
      },
      sshuttle: {
        ubuntu: {
          tool: 'sshuttle',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y sshuttle',
          notes: 'Or: pip3 install sshuttle',
        },
        kali: {
          tool: 'sshuttle',
          distro: 'kali',
          packageManager: 'apt',
          command: 'sudo apt update && sudo apt install -y sshuttle',
        },
        arch: {
          tool: 'sshuttle',
          distro: 'arch',
          packageManager: 'pacman',
          command: 'sudo pacman -S --noconfirm sshuttle',
        },
        darwin: {
          tool: 'sshuttle',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install sshuttle',
        },
        win32: {
          tool: 'sshuttle',
          distro: 'win32',
          packageManager: 'wsl',
          command: 'wsl sudo apt install -y sshuttle',
          notes: 'Best run via WSL (Linux-focused tool)',
        },
      },
      ngrok: {
        ubuntu: {
          tool: 'ngrok',
          distro: 'ubuntu',
          packageManager: 'apt',
          command: "curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo 'deb https://ngrok-agent.s3.amazonaws.com buster main' | sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install -y ngrok",
          notes: 'Requires a free ngrok account + authtoken. See https://ngrok.com/download',
        },
        kali: {
          tool: 'ngrok',
          distro: 'kali',
          packageManager: 'snap',
          command: 'sudo snap install ngrok',
          notes: 'Requires a free ngrok account + authtoken. See https://ngrok.com/download',
        },
        arch: {
          tool: 'ngrok',
          distro: 'arch',
          packageManager: 'aur',
          command: 'yay -S ngrok',
        },
        darwin: {
          tool: 'ngrok',
          distro: 'darwin',
          packageManager: 'brew',
          command: 'brew install ngrok/ngrok/ngrok',
        },
        win32: {
          tool: 'ngrok',
          distro: 'win32',
          packageManager: 'choco',
          command: 'choco install ngrok',
          notes: 'Or download from https://ngrok.com/download',
        },
      },
    };

    const toolCommands = commands[tool];
    if (!toolCommands) {
      return {
        tool,
        distro: mappedDistro,
        packageManager: 'unknown',
        command: `# Install ${tool} for your system`,
        notes: `Visit ${tool} documentation for installation instructions`,
      };
    }

    const selected = toolCommands[mappedDistro];
    if (selected) {
      return { ...selected, distro: mappedDistro };
    }

    return {
      tool,
      distro: mappedDistro,
      packageManager: 'unknown',
      command: `# Install ${tool} for ${distro}`,
      notes: `Check ${tool} documentation for ${distro} installation`,
    };
  }

  /**
   * Build a reviewable bash setup script for the selected runtime.
   *
   * OsecBox never executes this script automatically. External security tools
   * can require sudo, network access, licenses, or a deliberate version
   * choice; the user must review and run the copied script themselves.
   */
  getInstallScript(
    tools: string[],
    distro: string,
    runtime: InstallRuntime = 'wsl2',
  ): InstallScript {
    const selectedTools = [...new Set(
      (Array.isArray(tools) ? tools : [])
        .map(tool => typeof tool === 'string' ? tool.trim() : '')
        .filter(tool => installToolNamePattern.test(tool))
        .filter(tool => (SUPPORTED_INSTALL_TOOLS as readonly string[]).includes(tool)),
    )].slice(0, 32);
    const instructions = selectedTools.map(tool => this.getInstallCommand(tool, distro));
    const normalizedDistro = instructions[0]?.distro || String(distro || '').trim().toLowerCase() || 'unknown';
    const sudoToken = '${SUDO}';
    const lines = [
      '#!/usr/bin/env bash',
      'set -Eeuo pipefail',
      '',
      '# OsecBox generated setup helper.',
      '# Review each command and run this script only in the intended lab/runtime.',
      `# Runtime: ${runtime}; distro: ${normalizedDistro}`,
      '',
      'if [[ "$(id -u)" -eq 0 ]]; then',
      '  SUDO=""',
      'else',
      '  SUDO="sudo"',
      'fi',
      '',
      '# Keep Go and user-local installs visible to OsecBox after installation.',
      'export PATH="$HOME/go/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH"',
      '',
    ];

    for (const info of instructions) {
      const quotedTool = shellQuote(info.tool);
      const command = info.command.replace(/\bsudo\s+/g, `${sudoToken} `);
      const isManual = /^(download|# install)/i.test(info.command.trim());
      lines.push(
        `if command -v ${quotedTool} >/dev/null 2>&1; then`,
        `  echo "[skip] ${info.tool} is already available"`,
        'else',
        `  echo "[install] ${info.tool}"`,
        ...(info.notes ? [`  # ${info.notes.replace(/[\r\n]/g, ' ')}`] : []),
        ...(isManual
          ? [`  echo ${shellQuote(`Manual installation required: ${info.command}`)}`, '  exit 1']
          : [`  ${command}`]),
        'fi',
        '',
      );
    }

    lines.push(
      'echo',
      'echo "Setup complete. Restart or recheck OsecBox so the runtime PATH is probed again."',
      '',
    );

    return {
      runtime,
      shell: 'bash',
      distro: normalizedDistro,
      tools: selectedTools,
      script: lines.join('\n'),
      instructions,
    };
  }

  getAllToolCommands(distro: string): Record<string, InstallInstructions> {
    const result: Record<string, InstallInstructions> = {};

    SUPPORTED_INSTALL_TOOLS.forEach(tool => {
      result[tool] = this.getInstallCommand(tool, distro);
    });

    return result;
  }
}

export const toolInstaller = new ToolInstaller();
