@echo off
echo Starting Single Node (Development Mode)...
echo.

set PORT=5000
set NODE_ID=node-1
set WORKER_ID=1

echo Node ID: %NODE_ID%
echo Port: %PORT%
echo.

npm run dev