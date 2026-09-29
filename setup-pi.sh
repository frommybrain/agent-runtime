#!/bin/bash
# bootstrap a pi 5 as a 3aiii host
#
#   curl -fsSL https://raw.githubusercontent.com/frommybrain/agent-runtime/main/setup-pi.sh | bash -s -- <agent_id> <server_url>
#
# e.g.
#   curl -fsSL https://raw.githubusercontent.com/frommybrain/agent-runtime/main/setup-pi.sh | bash -s -- pip ws://192.168.1.100:4001
#
# or from a clone:
#   bash setup-pi.sh pip ws://192.168.1.100:4001

set -euo pipefail

AGENT_ID="${1:-}"
SERVER_URL="${2:-}"
GROQ_API_KEY="${3:-}"
OLLAMA_MODEL="${4:-qwen3:4b}"
CLOUD_MODEL="${5:-llama-3.3-70b-versatile}"
API_PORT="${6:-5000}"

if [ -z "$AGENT_ID" ] || [ -z "$SERVER_URL" ]; then
    echo "Usage: setup-pi.sh <agent_id> <server_url> [groq_api_key] [ollama_model] [cloud_model] [api_port]"
    echo "  agent_id:      pip, bean, mochi, taro, etc."
    echo "  server_url:    ws://YOUR_MAC_IP:4001"
    echo "  groq_api_key:  Groq API key (recommended - cloud primary, Ollama fallback)"
    echo "  ollama_model:  qwen3:4b (default, local fallback)"
    echo "  cloud_model:   llama-3.3-70b-versatile (default, Groq primary)"
    echo "  api_port:      5000 (default)"
    exit 1
fi

echo "3aiii - Pi Setup"
echo "  Agent:  $AGENT_ID"
echo "  Server: $SERVER_URL"
echo "  Cloud:  ${GROQ_API_KEY:+Groq ($CLOUD_MODEL)}${GROQ_API_KEY:-NONE (Ollama only)}"
echo "  Local:  $OLLAMA_MODEL (fallback)"
echo "  API:    port $API_PORT"
echo ""

echo "[1/7] Updating system packages..."
sudo apt update -qq && sudo apt upgrade -y -qq

echo "[2/7] Installing Node.js 20 LTS..."
if command -v node &> /dev/null && [[ "$(node -v)" == v20* ]]; then
    echo "  Node.js $(node -v) already installed"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y -qq nodejs
    echo "  Node.js $(node -v) installed"
fi

echo "[3/7] Installing Ollama..."
if command -v ollama &> /dev/null; then
    echo "  Ollama already installed"
else
    curl -fsSL https://ollama.com/install.sh | sh
fi

# 4 threads = the pi 5's cores. keep_alive stops ollama unloading the model
# between ticks
echo "[3/7] Configuring Ollama optimisations..."
if ! grep -q "OLLAMA_NUM_THREADS" /etc/environment 2>/dev/null; then
    sudo tee -a /etc/environment > /dev/null << 'ENVEOF'
OLLAMA_NUM_THREADS=4
OLLAMA_KEEP_ALIVE=24h
ENVEOF
    echo "  Added OLLAMA_NUM_THREADS=4 and OLLAMA_KEEP_ALIVE=24h"
fi

# /etc/environment only kicks in on next login
export OLLAMA_NUM_THREADS=4
export OLLAMA_KEEP_ALIVE=24h

# pull fails if the service isn't up yet
sudo systemctl start ollama 2>/dev/null || true
sleep 3

echo "[4/7] Pulling $OLLAMA_MODEL (this may take a while on first run)..."
ollama pull "$OLLAMA_MODEL"

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

cat > "$RUNTIME_DIR/.env" << ENVFILE
AGENT_ID=$AGENT_ID
PERSONA_PATH=./personas/$AGENT_ID.json
SERVER_URL=$SERVER_URL
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=$OLLAMA_MODEL
${GROQ_API_KEY:+CLOUD_API_KEY=$GROQ_API_KEY}
${GROQ_API_KEY:+CLOUD_API_URL=https://api.groq.com/openai/v1/chat/completions}
${GROQ_API_KEY:+CLOUD_MODEL=$CLOUD_MODEL}
HEARTBEAT_MS=8000
DATA_DIR=./data
API_PORT=$API_PORT
LOG_LEVEL=info
ENVFILE
# no groq key leaves blank lines from the ${:+} bits
sed -i '/^$/d' "$RUNTIME_DIR/.env"
echo "  .env created for $AGENT_ID"

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

# TODO: update.sh hardcodes /home/pi, won't work under any other user
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
    echo "[$(date)] Updated and restarted: $BEFORE -> $AFTER"
else
    echo "[$(date)] No changes"
fi
UPDATEEOF
chmod +x "$RUNTIME_DIR/update.sh"

# grep -v so a rerun doesn't stack up duplicate cron lines
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
