#!/bin/bash

# SPAC Strategy Frontend Runner
# This script sets up and runs the frontend application

set -e  # Exit on error

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

FRONTEND_DIR="frontend"
DATA_SOURCE_DIR="data/stock_data"
DATA_TARGET_DIR="frontend/public/data/stock_data"

echo "=========================================="
echo "SPAC Strategy Frontend Runner"
echo "=========================================="
echo ""

# Check if frontend directory exists
if [ ! -d "$FRONTEND_DIR" ]; then
    echo "❌ Error: Frontend directory not found!"
    exit 1
fi

# Copy data from data/stock_data to frontend/public/data/stock_data
echo "📁 Copying stock data to frontend..."
mkdir -p "$DATA_TARGET_DIR/spac"
mkdir -p "$DATA_TARGET_DIR/despac"

# Copy SPAC data
if [ -d "$DATA_SOURCE_DIR/spac" ]; then
    echo "  Copying SPAC data..."
    cp -r "$DATA_SOURCE_DIR/spac/"* "$DATA_TARGET_DIR/spac/" 2>/dev/null || true
    # Ensure news directory exists (even if empty)
    mkdir -p "$DATA_TARGET_DIR/spac/news"
    echo "  ✅ SPAC data copied (including news if available)"
else
    echo "  ⚠️  Warning: SPAC data directory not found"
fi

# Copy De-SPAC data
if [ -d "$DATA_SOURCE_DIR/despac" ]; then
    echo "  Copying De-SPAC data..."
    cp -r "$DATA_SOURCE_DIR/despac/"* "$DATA_TARGET_DIR/despac/" 2>/dev/null || true
    # Ensure news directory exists (even if empty)
    mkdir -p "$DATA_TARGET_DIR/despac/news"
    echo "  ✅ De-SPAC data copied (including news if available)"
else
    echo "  ⚠️  Warning: De-SPAC data directory not found"
fi

echo "✅ Data files copied to $DATA_TARGET_DIR"
echo ""

cd "$FRONTEND_DIR"

# Check if node_modules exists, if not install dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
    echo ""
else
    echo "✅ Dependencies already installed"
    echo ""
fi

echo ""
echo "=========================================="
echo "🔍 Checking for existing server on port 3000..."
echo "=========================================="

# Kill any process running on port 3000
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "⚠️  Found existing process on port 3000"
    PID=$(lsof -ti:3000)
    echo "   Killing process $PID..."
    kill -9 $PID 2>/dev/null || true
    sleep 1
    echo "✅ Process terminated"
else
    echo "✅ No existing process found on port 3000"
fi

echo ""
echo "=========================================="
echo "🚀 Starting development server..."
echo "=========================================="
echo ""
echo "The app will open at: http://localhost:3000/?clearCache=true"
echo "Cache will be cleared and data will be reloaded fresh"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start the dev server with CLEAR_CACHE environment variable
CLEAR_CACHE=true npm run dev

