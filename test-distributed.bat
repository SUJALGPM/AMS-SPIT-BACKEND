@echo off
echo Testing Distributed System Features...
echo.

echo 1. Testing Worker Threads...
call npm run test-workers
echo.

echo 2. Starting single node for health check...
start "Test-Node" cmd /k "set PORT=5000 && set NODE_ID=test-node && npm start"

echo Waiting for server to start...
timeout /t 5 /nobreak > nul

echo.
echo 3. Testing Health Endpoint...
curl http://localhost:5000/health
echo.

echo 4. Testing System Info Endpoint...
curl http://localhost:5000/system-info
echo.

echo 5. Stopping test node...
taskkill /FI "WINDOWTITLE eq Test-Node*" /F

echo.
echo Testing complete!
pause