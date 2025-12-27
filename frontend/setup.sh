#!/bin/bash
# Setup script to copy data files to public directory

mkdir -p public/data/stock_data
cp ../data/stock_data/*.csv ../data/stock_data/*.json public/data/stock_data/

echo "Data files copied to public/data/stock_data/"
echo "You can now run: npm install && npm run dev"

