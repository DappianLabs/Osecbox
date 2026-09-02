#!/usr/bin/env bash
# Install optional listener and tunneling tools used by OsecBox.

set -euo pipefail

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

export GOPATH="${GOPATH:-$HOME/go}"
export PATH="$PATH:$GOPATH/bin:$HOME/.local/bin"
mkdir -p "$GOPATH/bin"

install_pwncat() {
    if command -v pwncat-cs >/dev/null 2>&1; then
        echo "OK pwncat-cs already installed"
        return
    fi

    echo "Installing pwncat-cs..."
    if command -v pipx >/dev/null 2>&1; then
        pipx install pwncat-cs
    else
        python3 -m pip install --user --break-system-packages pwncat-cs || python3 -m pip install --user pwncat-cs
    fi
}

download_latest_asset() {
    local repository="$1"
    local pattern="$2"
    local destination="$3"
    local api_url="https://api.github.com/repos/${repository}/releases/latest"
    local asset_url

    asset_url="$(curl -fsSL "$api_url" | python3 -c "import json,re,sys; data=json.load(sys.stdin); matches=[a['browser_download_url'] for a in data.get('assets',[]) if re.search(sys.argv[1],a.get('name',''))]; print(matches[0] if matches else (_ for _ in ()).throw(SystemExit('No release asset matched: '+sys.argv[1])))" "$pattern")"
    curl -fL "$asset_url" -o "$destination"
}

case "$(uname -m)" in
    x86_64|amd64)
        chisel_arch="amd64"
        ligolo_arch="amd64"
        ;;
    aarch64|arm64)
        chisel_arch="arm64"
        ligolo_arch="arm64"
        ;;
    armv7l|armv7)
        chisel_arch="arm7"
        ligolo_arch="armv7"
        ;;
    *)
        echo "Unsupported architecture for optional binaries: $(uname -m)"
        exit 1
        ;;
esac

echo "Installing optional listener and tunneling tools..."
sudo apt-get update
sudo apt-get install -y curl python3 python3-pip unzip tar sshuttle

install_pwncat

if ! command -v chisel >/dev/null 2>&1; then
    echo "Installing chisel..."
    download_latest_asset "jpillora/chisel" "chisel_linux_${chisel_arch}\\.gz$" "$tmp_dir/chisel.gz"
    gunzip -c "$tmp_dir/chisel.gz" > "$tmp_dir/chisel"
    sudo install -m 0755 "$tmp_dir/chisel" /usr/local/bin/chisel
fi

if ! command -v ligolo-ng >/dev/null 2>&1; then
    echo "Installing ligolo-ng agent..."
    download_latest_asset "nicocha30/ligolo-ng" "ligolo-ng_agent_.*_linux_${ligolo_arch}\\.tar\\.gz$" "$tmp_dir/ligolo.tar.gz"
    tar -xzf "$tmp_dir/ligolo.tar.gz" -C "$tmp_dir"
    ligolo_agent="$(find "$tmp_dir" -maxdepth 2 -type f -name 'agent*' | head -n1)"
    if [ -z "$ligolo_agent" ]; then
        echo "Ligolo-ng release did not contain an agent binary."
        exit 1
    fi
    sudo install -m 0755 "$ligolo_agent" /usr/local/bin/ligolo-ng
fi

echo "Verifying optional tools..."
for tool in pwncat-cs chisel ligolo-ng sshuttle; do
    if command -v "$tool" >/dev/null 2>&1; then
        echo "OK $tool"
    else
        echo "MISSING $tool"
        exit 1
    fi
done

echo "Optional tool installation finished successfully."
