@echo off
chcp 65001 > nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv
  if errorlevel 1 (echo Khong tao duoc virtualenv. Hay cai Python 3.10+ & pause & exit /b 1)
)
.venv\Scripts\python.exe -c "import fastapi,uvicorn,jwt,qrcode,multipart,httpx,gtts" > nul 2>&1
if errorlevel 1 (
  echo Dang cai thu vien Python lan dau. Hay dam bao co Internet.
  .venv\Scripts\python.exe -m pip install --no-cache-dir -r requirements.txt
  if errorlevel 1 (echo Cai dat thu vien that bai. Kiem tra RAM va bo nho ao Windows. & pause & exit /b 1)
)
if not exist ".env" copy ".env.example" ".env" > nul
echo Truy cap http://127.0.0.1:8000 khi server khoi dong xong.
start "" "http://127.0.0.1:8000"
.venv\Scripts\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8000
pause
