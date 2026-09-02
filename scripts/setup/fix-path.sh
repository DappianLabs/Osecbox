#!/bin/bash
# Add Go bin to PATH if not already there
if ! grep -q "export PATH=\$PATH:\$HOME/go/bin" ~/.bashrc; then
    echo 'export PATH=$PATH:$HOME/go/bin' >> ~/.bashrc
    echo "✅ Added ~/go/bin to PATH in ~/.bashrc"
else
    echo "✅ ~/go/bin already in PATH"
fi

# Source it for current session
export PATH=$PATH:$HOME/go/bin

# Test all tools
echo ""
echo "🔍 Checking all tools..."
echo ""

tools=("nmap" "nikto" "gobuster" "subfinder" "httpx" "nuclei" "assetfinder" "amass" "ffuf" "findomain")

for tool in "${tools[@]}"; do
    if command -v $tool &> /dev/null; then
        location=$(which $tool)
        echo "✓ $tool → $location"
    else
        echo "✗ $tool: NOT FOUND"
    fi
done

echo ""
echo "Note: Restart your terminal or run 'source ~/.bashrc' to apply changes"
