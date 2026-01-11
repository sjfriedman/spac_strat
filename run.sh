#!/bin/bash

# SPAC Strategy Frontend Runner
# This script sets up and runs the frontend application

set -e  # Exit on error

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check for required commands
echo "🔍 Checking prerequisites..."
MISSING_DEPS=0

if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed. Please install Node.js from https://nodejs.org/"
    MISSING_DEPS=1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm is not installed. Please install npm (usually comes with Node.js)"
    MISSING_DEPS=1
fi

if [ $MISSING_DEPS -eq 1 ]; then
    exit 1
fi

echo "✅ Prerequisites check passed"
echo ""

FRONTEND_DIR="frontend"
DATA_SOURCE_DIR="data/stock_data"
DATA_TARGET_DIR="frontend/public/data/stock_data"
INSIDER_SOURCE_DIR="data/insider_transactions"
INSIDER_TARGET_DIR="frontend/public/data/insider_transactions"

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

# Copy insider transactions data from data/insider_transactions to frontend/public/data/insider_transactions
echo "📁 Copying insider transactions data to frontend..."
mkdir -p "$INSIDER_TARGET_DIR/spac"
mkdir -p "$INSIDER_TARGET_DIR/despac"

# Copy SPAC insider transactions
if [ -d "$INSIDER_SOURCE_DIR/spac" ]; then
    echo "  Copying SPAC insider transactions..."
    cp -r "$INSIDER_SOURCE_DIR/spac/"*.csv "$INSIDER_TARGET_DIR/spac/" 2>/dev/null || true
    cp -r "$INSIDER_SOURCE_DIR/spac/"*.json "$INSIDER_TARGET_DIR/spac/" 2>/dev/null || true
    echo "  ✅ SPAC insider transactions copied"
else
    echo "  ⚠️  Warning: SPAC insider transactions directory not found"
fi

# Copy De-SPAC insider transactions
if [ -d "$INSIDER_SOURCE_DIR/despac" ]; then
    echo "  Copying De-SPAC insider transactions..."
    cp -r "$INSIDER_SOURCE_DIR/despac/"*.csv "$INSIDER_TARGET_DIR/despac/" 2>/dev/null || true
    cp -r "$INSIDER_SOURCE_DIR/despac/"*.json "$INSIDER_TARGET_DIR/despac/" 2>/dev/null || true
    echo "  ✅ De-SPAC insider transactions copied"
else
    echo "  ⚠️  Warning: De-SPAC insider transactions directory not found"
fi

echo "✅ Insider transactions data copied to $INSIDER_TARGET_DIR"
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
# Try lsof first (macOS/Linux), fall back to other methods if needed
if command -v lsof &> /dev/null; then
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
else
    # Fallback: try to find process using port 3000 with netstat or ss
    if command -v netstat &> /dev/null; then
        PID=$(netstat -anv | grep -i "3000.*LISTEN" | awk '{print $9}' | head -1)
        if [ ! -z "$PID" ]; then
            echo "⚠️  Found existing process on port 3000"
            echo "   Killing process $PID..."
            kill -9 $PID 2>/dev/null || true
            sleep 1
            echo "✅ Process terminated"
        else
            echo "✅ No existing process found on port 3000"
        fi
    else
        echo "⚠️  Warning: Could not check for existing processes on port 3000"
        echo "   (lsof and netstat not available)"
    fi
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

