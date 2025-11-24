@echo off
echo ========================================
echo Distributed Attendance Management System
echo Quick Start Menu
echo ========================================
echo.
echo Choose an option:
echo.
echo 1. Single Node (Development)
echo 2. Clustered Mode (Auto-scaling)
echo 3. Multiple Nodes (4 instances)
echo 4. Test Distributed Features
echo 5. View System Health
echo 6. Exit
echo.
set /p choice="Enter your choice (1-6): "

if "%choice%"=="1" goto single
if "%choice%"=="2" goto cluster
if "%choice%"=="3" goto multiple
if "%choice%"=="4" goto test
if "%choice%"=="5" goto health
if "%choice%"=="6" goto end

:single
echo.
echo Starting Single Node on port 5000...
call start-single-node.bat
goto end

:cluster
echo.
echo Starting Clustered Mode...
npm run cluster
goto end

:multiple
echo.
echo Starting Multiple Nodes...
call start-cluster.bat
goto end

:test
echo.
echo Testing Distributed Features...
call test-distributed.bat
goto end

:health
echo.
echo Checking System Health...
echo.
curl http://localhost:5000/health
echo.
echo.
curl http://localhost:5000/system-info
echo.
pause
goto end

:end
echo.
echo Thank you for using the Distributed Attendance System!
pause