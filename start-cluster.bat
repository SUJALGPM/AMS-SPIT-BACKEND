@echo off
echo Starting Distributed Attendance Management System...
echo.

echo Starting Node 1 on port 5000...
start "Node-1" cmd /k "set PORT=5000 && set NODE_ID=node-1 && set WORKER_ID=1 && npm start"

timeout /t 2 /nobreak > nul

echo Starting Node 2 on port 5001...
start "Node-2" cmd /k "set PORT=5001 && set NODE_ID=node-2 && set WORKER_ID=2 && npm start"

timeout /t 2 /nobreak > nul

echo Starting Node 3 on port 5002...
start "Node-3" cmd /k "set PORT=5002 && set NODE_ID=node-3 && set WORKER_ID=3 && npm start"

timeout /t 2 /nobreak > nul

echo Starting Node 4 on port 5003...
start "Node-4" cmd /k "set PORT=5003 && set NODE_ID=node-4 && set WORKER_ID=4 && npm start"

echo.
echo All nodes are starting...
echo Node 1: http://localhost:5000
echo Node 2: http://localhost:5001
echo Node 3: http://localhost:5002
echo Node 4: http://localhost:5003
echo.
echo Press any key to stop all nodes...
pause > nul

taskkill /FI "WINDOWTITLE eq Node-1*" /F
taskkill /FI "WINDOWTITLE eq Node-2*" /F
taskkill /FI "WINDOWTITLE eq Node-3*" /F
taskkill /FI "WINDOWTITLE eq Node-4*" /F

echo All nodes stopped.
pause