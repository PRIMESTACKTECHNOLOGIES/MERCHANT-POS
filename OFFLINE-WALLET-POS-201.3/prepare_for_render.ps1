# ═════════════════════════════════════════════════════════════════════════════
# POS OFFLINE SYSTEM - RENDER DEPLOYMENT PREPARATION SCRIPT
# ═════════════════════════════════════════════════════════════════════════════
# Run this script to prepare your project for deployment to Render.com
# ═════════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     POS OFFLINE SYSTEM - RENDER DEPLOYMENT PREPARATION                       ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "./render.yaml")) {
    Write-Host "❌ ERROR: Please run this script from the POS OFFLINE SFTWR folder!" -ForegroundColor Red
    Write-Host "   Current location: $(Get-Location)"
    exit 1
}

Write-Host "✅ Found project files" -ForegroundColor Green
Write-Host ""

# ═════════════════════════════════════════════════════════════════════════════
# STEP 1: Check Git Status
# ═════════════════════════════════════════════════════════════════════════════
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "STEP 1: Checking Git Repository" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow

if (Test-Path ".git") {
    Write-Host "✅ Git repository initialized" -ForegroundColor Green
    
    # Check for uncommitted changes
    $status = git status --porcelain
    if ($status) {
        Write-Host "⚠️  Warning: You have uncommitted changes:" -ForegroundColor Yellow
        Write-Host $status
        
        $commit = Read-Host "Do you want to commit these changes? (y/n)"
        if ($commit -eq "y") {
            $message = Read-Host "Enter commit message"
            git add .
            git commit -m "$message"
            Write-Host "✅ Changes committed" -ForegroundColor Green
        }
    } else {
        Write-Host "✅ No uncommitted changes" -ForegroundColor Green
    }
    
    # Check remote
    $remote = git remote -v
    if ($remote) {
        Write-Host "✅ Git remote configured:" -ForegroundColor Green
        Write-Host $remote
    } else {
        Write-Host "❌ No Git remote configured" -ForegroundColor Red
        Write-Host "   Run: git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git"
    }
} else {
    Write-Host "❌ Git not initialized" -ForegroundColor Red
    Write-Host "   Run these commands:" -ForegroundColor Yellow
    Write-Host "   git init"
    Write-Host "   git add ."
    Write-Host "   git commit -m 'Initial commit'"
}

Write-Host ""

# ═════════════════════════════════════════════════════════════════════════════
# STEP 2: Verify Configuration Files
# ═════════════════════════════════════════════════════════════════════════════
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "STEP 2: Verifying Configuration Files" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow

$requiredFiles = @(
    "render.yaml",
    "Dockerfile",
    "docker-compose.yml",
    "package.json"
)

$allPresent = $true
foreach ($file in $requiredFiles) {
    if (Test-Path $file) {
        Write-Host "✅ $file" -ForegroundColor Green
    } else {
        Write-Host "❌ $file - MISSING!" -ForegroundColor Red
        $allPresent = $false
    }
}

Write-Host ""

# ═════════════════════════════════════════════════════════════════════════════
# STEP 3: Check Android Configuration
# ═════════════════════════════════════════════════════════════════════════════
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "STEP 3: Checking Android Configuration" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow

$configFile = "./android_pos_app/app/src/main/java/com/pos2013/offline/config/GatewayConfig.kt"
if (Test-Path $configFile) {
    Write-Host "✅ GatewayConfig.kt found" -ForegroundColor Green
    
    # Check if using local or production
    $content = Get-Content $configFile -Raw
    if ($content -match 'USE_LOCAL\s*=\s*false') {
        Write-Host "✅ App configured for PRODUCTION mode" -ForegroundColor Green
    } else {
        Write-Host "⚠️  App currently configured for LOCAL mode" -ForegroundColor Yellow
        Write-Host "   After deploying to Render, change USE_LOCAL = false in GatewayConfig.kt" -ForegroundColor Yellow
    }
    
    # Extract Render URL
    if ($content -match 'RENDER_URL\s*=\s*"([^"]+)"') {
        $renderUrl = $matches[1]
        Write-Host "   Current Render URL: $renderUrl" -ForegroundColor Cyan
    }
} else {
    Write-Host "❌ GatewayConfig.kt not found!" -ForegroundColor Red
}

Write-Host ""

# ═════════════════════════════════════════════════════════════════════════════
# STEP 4: Test Backend Build
# ═════════════════════════════════════════════════════════════════════════════
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "STEP 4: Testing Backend Build" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow

Write-Host "Checking Node.js..."
$nodeVersion = node --version 2>$null
if ($nodeVersion) {
    Write-Host "✅ Node.js $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "❌ Node.js not found!" -ForegroundColor Red
    Write-Host "   Download from: https://nodejs.org/" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Testing backend build locally..." -ForegroundColor Cyan

Set-Location backend

# Install dependencies if needed
if (-not (Test-Path "./node_modules")) {
    Write-Host "Installing backend dependencies..." -ForegroundColor Cyan
    npm install
}

# Try to build
Write-Host "Building backend..." -ForegroundColor Cyan
npm run build 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Backend builds successfully" -ForegroundColor Green
} else {
    Write-Host "❌ Backend build failed!" -ForegroundColor Red
    Write-Host "   Check for TypeScript errors" -ForegroundColor Yellow
}

Set-Location ..

Write-Host ""

# ═════════════════════════════════════════════════════════════════════════════
# STEP 5: Generate Deployment Checklist
# ═════════════════════════════════════════════════════════════════════════════
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "STEP 5: Deployment Checklist" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow

Write-Host ""
Write-Host "Before deploying to Render, ensure:" -ForegroundColor White
Write-Host ""

$checklist = @(
    "Code is pushed to GitHub",
    "GitHub repository is Private (recommended)",
    "render.yaml is configured correctly",
    "Environment variables are set in render.yaml",
    "MyFatoorah token is ready (for live payments)",
    "You have a Render account",
    "You're willing to pay $7/month for Starter plan"
)

$checklist | ForEach-Object { Write-Host "   □ $_" -ForegroundColor Gray }

Write-Host ""

# ═════════════════════════════════════════════════════════════════════════════
# STEP 6: Quick Deploy Option
# ═════════════════════════════════════════════════════════════════════════════
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "STEP 6: Next Steps" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow

Write-Host ""
Write-Host "🚀 READY TO DEPLOY? Follow these steps:" -ForegroundColor Green
Write-Host ""
Write-Host "1. Push to GitHub:" -ForegroundColor Cyan
Write-Host "   git push origin main" -ForegroundColor White
Write-Host ""
Write-Host "2. Go to Render Dashboard:" -ForegroundColor Cyan
Write-Host "   https://dashboard.render.com/" -ForegroundColor White
Write-Host ""
Write-Host "3. Click 'New +' → 'Blueprint'" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Connect your GitHub repository" -ForegroundColor Cyan
Write-Host ""
Write-Host "5. Click 'Apply' - Render will deploy automatically!" -ForegroundColor Cyan
Write-Host ""

# ═════════════════════════════════════════════════════════════════════════════
# Display Current IP for Local Testing
# ═════════════════════════════════════════════════════════════════════════════
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow
Write-Host "LOCAL TESTING INFO" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Yellow

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "192.168.56.*" } | Select-Object -First 1).IPAddress
if ($ip) {
    Write-Host "Your PC IP Address: $ip" -ForegroundColor Cyan
    Write-Host "Local Backend URL: http://$ip`:3000/" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "Preparation complete! Read DEPLOY_TO_RENDER.md for detailed instructions." -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""

Pause
