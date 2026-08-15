@echo off
chcp 65001 >nul
cd /d "%~dp0"

start "" cmd /c "timeout /t 1 /nobreak >nul & start http://127.0.0.1:8080/"

where node >nul 2>&1
if %errorlevel%==0 (
  echo 本機伺服器：http://127.0.0.1:8080/
  echo 關閉此視窗即停止伺服器。
  node js\static-server.mjs
  goto :eof
)

where py >nul 2>&1
if %errorlevel%==0 (
  echo 本機伺服器：http://127.0.0.1:8080/
  echo 關閉此視窗即停止伺服器。
  py -m http.server 8080 --bind 127.0.0.1
  goto :eof
)

where python >nul 2>&1
if %errorlevel%==0 (
  echo 本機伺服器：http://127.0.0.1:8080/
  echo 關閉此視窗即停止伺服器。
  python -m http.server 8080 --bind 127.0.0.1
  goto :eof
)

echo 找不到 Node 或 Python，無法開本機伺服器。
echo 請改用有網路的方式雙擊 index.html，或開啟：
echo https://twmf1323-source.github.io/Mal/
pause
