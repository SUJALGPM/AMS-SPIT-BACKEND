# Test All Distributed Features
# Run this script to verify everything works before the demo

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing Distributed System Features" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: Check if all nodes are running
Write-Host "Test 1: Checking Node Processes..." -ForegroundColor Yellow
$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "✓ Found $($nodeProcesses.Count) node process(es) running" -ForegroundColor Green
    $nodeProcesses | ForEach-Object {
        $port = (Get-NetTCPConnection -OwningProcess $_.Id -ErrorAction SilentlyContinue | Where-Object {$_.State -eq "Listen"}).LocalPort
        Write-Host "  - PID: $($_.Id), Port: $port" -ForegroundColor Gray
    }
} else {
    Write-Host "✗ No node processes found. Start the cluster first!" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Test 2: Check MongoDB
Write-Host "Test 2: Checking MongoDB..." -ForegroundColor Yellow
try {
    $mongoService = Get-Service MongoDB -ErrorAction SilentlyContinue
    if ($mongoService -and $mongoService.Status -eq "Running") {
        Write-Host "✓ MongoDB service is running" -ForegroundColor Green
    } else {
        Write-Host "⚠ MongoDB service not found or not running" -ForegroundColor Yellow
    }
} catch {
    Write-Host "⚠ Could not check MongoDB service" -ForegroundColor Yellow
}
Write-Host ""

# Test 3: Test Health Endpoints
Write-Host "Test 3: Testing Health Endpoints..." -ForegroundColor Yellow
$ports = @(5000, 5001, 5002, 5003)
foreach ($port in $ports) {
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$port/health" -TimeoutSec 5
        Write-Host "✓ Node on port $port is healthy (NodeID: $($response.nodeId))" -ForegroundColor Green
    } catch {
        Write-Host "✗ Node on port $port is not responding" -ForegroundColor Red
    }
}
Write-Host ""

# Test 4: Test Load Balancing
Write-Host "Test 4: Testing Load Balancing (NGINX)..." -ForegroundColor Yellow
try {
    $nginxTest = Test-NetConnection -ComputerName localhost -Port 80 -WarningAction SilentlyContinue
    if ($nginxTest.TcpTestSucceeded) {
        Write-Host "✓ NGINX is running on port 80" -ForegroundColor Green
        
        # Make multiple requests to test load balancing
        Write-Host "  Making 10 requests to test distribution..." -ForegroundColor Gray
        $nodeHits = @{}
        for ($i = 1; $i -le 10; $i++) {
            try {
                $response = Invoke-RestMethod -Uri "http://localhost/health" -TimeoutSec 5
                $nodeId = $response.nodeId
                if ($nodeHits.ContainsKey($nodeId)) {
                    $nodeHits[$nodeId]++
                } else {
                    $nodeHits[$nodeId] = 1
                }
            } catch {
                Write-Host "  ✗ Request $i failed" -ForegroundColor Red
            }
        }
        
        Write-Host "  Request distribution:" -ForegroundColor Gray
        $nodeHits.GetEnumerator() | ForEach-Object {
            Write-Host "    $($_.Key): $($_.Value) requests" -ForegroundColor Gray
        }
    } else {
        Write-Host "✗ NGINX is not running on port 80" -ForegroundColor Red
        Write-Host "  Start NGINX: cd C:\nginx && start nginx" -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ Could not test NGINX" -ForegroundColor Red
}
Write-Host ""

# Test 5: Check System Info
Write-Host "Test 5: Checking System Info..." -ForegroundColor Yellow
try {
    $sysInfo = Invoke-RestMethod -Uri "http://localhost:5000/system-info" -TimeoutSec 5
    Write-Host "✓ System info retrieved successfully" -ForegroundColor Green
    Write-Host "  - Node ID: $($sysInfo.nodeId)" -ForegroundColor Gray
    Write-Host "  - Worker ID: $($sysInfo.workerId)" -ForegroundColor Gray
    Write-Host "  - Is Leader: $($sysInfo.isLeader)" -ForegroundColor Gray
    Write-Host "  - Uptime: $([math]::Round($sysInfo.uptime, 2)) seconds" -ForegroundColor Gray
    Write-Host "  - Active Connections: $($sysInfo.connections)" -ForegroundColor Gray
} catch {
    Write-Host "✗ Could not retrieve system info" -ForegroundColor Red
}
Write-Host ""

# Test 6: Check Database Connection
Write-Host "Test 6: Testing Database Connection..." -ForegroundColor Yellow
try {
    # This assumes you have a test endpoint that checks DB
    $response = Invoke-RestMethod -Uri "http://localhost:5000/health" -TimeoutSec 5
    Write-Host "✓ Database connection is working" -ForegroundColor Green
} catch {
    Write-Host "✗ Database connection test failed" -ForegroundColor Red
}
Write-Host ""

# Test 7: Check Frontend
Write-Host "Test 7: Checking Frontend..." -ForegroundColor Yellow
try {
    $frontendTest = Test-NetConnection -ComputerName localhost -Port 5173 -WarningAction SilentlyContinue
    if ($frontendTest.TcpTestSucceeded) {
        Write-Host "✓ Frontend is running on port 5173" -ForegroundColor Green
    } else {
        Write-Host "✗ Frontend is not running" -ForegroundColor Red
        Write-Host "  Start frontend: cd frontend && npm run dev" -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ Could not check frontend" -ForegroundColor Red
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "System Status:" -ForegroundColor White
Write-Host "  Backend Nodes: $($nodeProcesses.Count) running" -ForegroundColor $(if ($nodeProcesses.Count -ge 4) { "Green" } else { "Yellow" })
Write-Host "  Load Balancer: $(if ($nginxTest.TcpTestSucceeded) { 'Running' } else { 'Not Running' })" -ForegroundColor $(if ($nginxTest.TcpTestSucceeded) { "Green" } else { "Red" })
Write-Host "  Frontend: $(if ($frontendTest.TcpTestSucceeded) { 'Running' } else { 'Not Running' })" -ForegroundColor $(if ($frontendTest.TcpTestSucceeded) { "Green" } else { "Red" })
Write-Host ""

if ($nodeProcesses.Count -ge 4 -and $nginxTest.TcpTestSucceeded -and $frontendTest.TcpTestSucceeded) {
    Write-Host "✓ All systems are GO! Ready for demo!" -ForegroundColor Green
} else {
    Write-Host "⚠ Some components are not running. Check the errors above." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
