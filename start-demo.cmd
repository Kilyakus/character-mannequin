@echo off
setlocal
cd /d "%~dp0"
if not exist "index.html" goto missing
if not exist "demo\main.js" goto missing
if not exist "src\index.js" goto missing
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm are required. Install Node.js 20.19 or newer.
  goto end
)
if not exist "node_modules\vite\package.json" (
  echo Installing project dependencies...
  call npm ci
  if errorlevel 1 (
    echo Dependency installation failed. See the error above.
    goto end
  )
)
echo.
echo Open http://127.0.0.1:5173/ in your browser.
echo Keep this window open. Press Ctrl+C to stop the server.
echo.
call npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
if errorlevel 1 echo Server failed. If port 5173 is occupied, stop the other program and try again.
goto end
:missing
echo Project files are missing. Extract the full ZIP before running this file.
:end
pause
