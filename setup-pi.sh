#!/bin/bash
# =============================================================================
# setup-pi.sh — Bootstrap a Raspberry Pi 5 as an agent-runtime host
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/frommybrain/agent-runtime/main/setup-pi.sh | bash -s -- <agent_id> <server_url>
#
# Example:
#   curl -fsSL https://raw.githubusercontent.com/frommybrain/agent-runtime/main/setup-pi.sh | bash -s -- pip ws://192.168.1.100:4001
#
# Or if already cloned:
#   bash setup-pi.sh pip ws://192.168.1.100:4001
# =============================================================================

set -euo pipefail

AGENT_ID="${1:-}"
SERVER_URL="${2:-}"
OLLAMA_MODEL="${3:-qwen2.5:3b}"
API_PORT="${4:-5000}"

if [ -z "$AGENT_ID" ] || [ -z "$SERVER_URL" ]; then
    echo "Usage: setup-pi.sh <agent_id> <server_url> [model] [api_port]"
    echo "  agent_id:   pip, bean, mochi, taro, etc."
    echo "  server_url: ws://YOUR_MAC_IP:4001"
    echo "  model:      qwen2.5:3b (default)"
    echo "  api_port:   5000 (default)"
    exit 1
fi

echo "============================================"
echo "  Agent Runtime — Pi Setup"
echo "  Agent:  $AGENT_ID"
echo "  Server: $SERVER_URL"
echo "  Model:  $OLLAMA_MODEL"
echo "  API:    port $API_PORT"
echo "============================================"
echo ""

# --- Step 1: System update ---
echo "[1/7] Updating system packages..."
sudo apt update -qq && sudo apt upgrade -y -qq

# --- Step 2: Install Node.js 20 ---
echo "[2/7] Installing Node.js 20 LTS..."
if command -v node &> /dev/null && [[ "$(node -v)" == v20* ]]; then
    echo "  Node.js $(node -v) already installed"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y -qq nodejs
    echo "  Node.js $(node -v) installed"
fi

# --- Step 3: Install Ollama ---
echo "[3/7] Installing Ollama..."
if command -v ollama &> /dev/null; then
    echo "  Ollama already installed"
else
    curl -fsSL https://ollama.com/install.sh | sh
fi

# Configure Ollama optimisations for Pi 5
echo "[3/7] Configuring Ollama optimisations..."
if ! grep -q "OLLAMA_NUM_THREADS" /etc/environment 2>/dev/null; then
    sudo tee -a /etc/environment > /dev/null << 'ENVEOF'
OLLAMA_NUM_THREADS=4
OLLAMA_KEEP_ALIVE=24h
ENVEOF
    echo "  Added OLLAMA_NUM_THREADS=4 and OLLAMA_KEEP_ALIVE=24h"
fi

# Export for current session
export OLLAMA_NUM_THREADS=4
export OLLAMA_KEEP_ALIVE=24h

# Ensure Ollama service is running before pulling model
sudo systemctl start ollama 2>/dev/null || true
sleep 3

# --- Step 4: Pull model ---
echo "[4/7] Pulling $OLLAMA_MODEL (this may take a while on first run)..."
ollama pull "$OLLAMA_MODEL"

# --- Step 5: Clone/update agent-runtime ---
echo "[5/7] Setting up agent-runtime..."
RUNTIME_DIR="$HOME/agent-runtime"

if [ -d "$RUNTIME_DIR/.git" ]; then
    echo "  Repo exists, pulling latest..."
    cd "$RUNTIME_DIR"
    git pull origin main
else
    echo "  Cloning repo..."
    git clone https://github.com/frommybrain/agent-runtime.git "$RUNTIME_DIR"
    cd "$RUNTIME_DIR"
fi

npm install --production

# Generate .env
cat > "$RUNTIME_DIR/.env" << ENVFILE
AGENT_ID=$AGENT_ID
PERSONA_PATH=./personas/$AGENT_ID.json
SERVER_URL=$SERVER_URL
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=$OLLAMA_MODEL
HEARTBEAT_MS=8000
DATA_DIR=./data
API_PORT=$API_PORT
LOG_LEVEL=info
ENVFILE
echo "  .env created for $AGENT_ID"

# --- Step 6: Create systemd service ---
echo "[6/7] Creating systemd service..."
sudo tee /etc/systemd/system/agent-runtime.service > /dev/null << SERVICEEOF
[Unit]
Description=Agent Runtime ($AGENT_ID)
After=network-online.target ollama.service
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$RUNTIME_DIR
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICEEOF

sudo systemctl daemon-reload
sudo systemctl enable agent-runtime
echo "  Service created and enabled"

# --- Step 7: Set up auto-update cron ---
echo "[7/7] Setting up auto-update cron..."
cat > "$RUNTIME_DIR/update.sh" << 'UPDATEEOF'
#!/bin/bash
cd /home/pi/agent-runtime
BEFORE=$(git rev-parse HEAD)
git pull origin main
AFTER=$(git rev-parse HEAD)
if [ "$BEFORE" != "$AFTER" ]; then
    npm install --production
    sudo systemctl restart agent-runtime
    echo "[$(date)] Updated and restarted: $BEFORE → $AFTER"
else
    echo "[$(date)] No changes"
fi
UPDATEEOF
chmod +x "$RUNTIME_DIR/update.sh"

# Add cron job if not already present
CRON_LINE="*/15 * * * * $RUNTIME_DIR/update.sh >> $RUNTIME_DIR/update.log 2>&1"
(crontab -l 2>/dev/null | grep -v "update.sh"; echo "$CRON_LINE") | crontab -
echo "  Auto-update cron set (every 15 minutes)"

echo ""
echo "============================================"
echo "  Setup complete!"
echo ""
echo "  Start the agent:"
echo "    sudo systemctl start agent-runtime"
echo ""
echo "  View logs:"
echo "    journalctl -u agent-runtime -f"
echo ""
echo "  Check status:"
echo "    curl http://localhost:$API_PORT/status"
echo ""
echo "  IMPORTANT: Ensure your world server is"
echo "  running at $SERVER_URL"
echo "============================================"
