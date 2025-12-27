#!/bin/bash

# SPAC Strategy Frontend Runner
# This script sets up and runs the frontend application

set -e  # Exit on error

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

# Verify data files exist in source directory
echo "📁 Verifying data files..."
if [ ! -f "../$DATA_SOURCE_DIR/stock_data.csv" ]; then
    echo "⚠️  Warning: stock_data.csv not found in $DATA_SOURCE_DIR"
fi

if [ ! -f "../$DATA_SOURCE_DIR/stock_volume.csv" ]; then
    echo "⚠️  Warning: stock_volume.csv not found in $DATA_SOURCE_DIR"
fi

if [ ! -f "../$DATA_SOURCE_DIR/ipo_dates.json" ]; then
    echo "⚠️  Warning: ipo_dates.json not found in $DATA_SOURCE_DIR"
fi

echo "✅ Data files will be read directly from ../$DATA_SOURCE_DIR"

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

