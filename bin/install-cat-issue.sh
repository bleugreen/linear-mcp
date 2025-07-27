#!/bin/bash

# Install cat-issue command globally

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/cat-issue"

echo "Installing cat-issue command..."

# Check if script exists
if [ ! -f "$SCRIPT_PATH" ]; then
    echo "Error: cat-issue script not found at $SCRIPT_PATH"
    exit 1
fi

# Create symlink in /usr/local/bin
if [ -w /usr/local/bin ]; then
    ln -sf "$SCRIPT_PATH" /usr/local/bin/cat-issue
    echo "✓ Installed to /usr/local/bin/cat-issue"
else
    # Try with sudo
    echo "Need sudo access to install to /usr/local/bin"
    sudo ln -sf "$SCRIPT_PATH" /usr/local/bin/cat-issue
    echo "✓ Installed to /usr/local/bin/cat-issue"
fi

# Check if LINEAR_API_KEY is set
if [ -z "$LINEAR_API_KEY" ]; then
    echo ""
    echo "⚠️  LINEAR_API_KEY not found in environment"
    echo ""
    echo "To use cat-issue, you need to set your Linear API key:"
    echo ""
    echo "1. Get your API key from: https://linear.app/settings/api"
    echo ""
    echo "2. Add to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo "   export LINEAR_API_KEY='lin_api_YOUR_KEY_HERE'"
    echo ""
    echo "3. Or add to the .env file in the linear-mcp directory"
    echo ""
fi

echo ""
echo "Usage: cat-issue ISSUE-ID"
echo "Example: cat-issue FIRM-123"