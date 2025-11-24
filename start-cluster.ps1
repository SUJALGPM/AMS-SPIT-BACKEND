# PowerShell script to start distributed cluster
Write-Host "Starting Distributed Attendance Management System..." -ForegroundColor Green
Write-Host ""

# Function to start a node
function Start-Node {
    param(
        [int]$Port,
        [string]$NodeId,
        [int]$WorkerId
    )
    
    $env:PORT = $Port
    $env:NODE_ID = $NodeId
    $env:WORKER_ID = $WorkerId
    
    Write-Host "Starting $NodeId on port $Port..." -ForegroundColor Cyan
    
    Start-Process powershell -ArgumentList "-NoExit", "-Command", `
        "`$env:PORT='$Port'; `$env:NODE_ID='$NodeId'; `$env:WORKER_ID='$WorkerId'; npm start" `
        -WindowStyle Normal
    
    Start-Sleep -Seconds 2
}

# Start 4 nodes
Start-Node -Port 5000 -NodeId "node-1" -WorkerId 1
Start-Node -Port 5001 -NodeId "node-2" -WorkerId 2
Start-Node -Port 5002 -NodeId "node-3" -WorkerId 3
Start-Node -Port 5003 -NodeId "node-4" -WorkerId 4

Write-Host ""
Write-Host "All nodes are starting..." -ForegroundColor Green
Write-Host "Node 1: http://localhost:5000" -ForegroundColor Yellow
Write-Host "Node 2: http://localhost:5001" -ForegroundColor Yellow
Write-Host "Node 3: http://localhost:5002" -ForegroundColor Yellow
Write-Host "Node 4: http://localhost:5003" -ForegroundColor Yellow
Write-Host ""
Write-Host "Press Ctrl+C to stop all nodes" -ForegroundColor Red
Write-Host ""

# Keep script running
try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
}
finally {
    Write-Host "Stopping all nodes..." -ForegroundColor Red
    Get-Process | Where-Object {$_.MainWindowTitle -like "*node-*"} | Stop-Process -Force
}