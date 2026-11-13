@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 蟹卡预约助手 - 安装
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有检测到 Node.js。
  echo 请先安装 Node.js 长期支持版 LTS： https://nodejs.org/zh-cn
  echo 安装完成后，重新双击 install.bat。
  pause
  exit /b 1
)
echo 正在安装程序依赖……
call npm install
if errorlevel 1 goto failed
echo 正在安装 Chromium 浏览器……
call npx playwright install chromium
if errorlevel 1 goto failed
echo.
echo [完成] 安装成功。现在可以双击 start.bat 启动。
pause
exit /b 0
:failed
echo.
echo [失败] 安装没有完成。请检查网络后重新运行 install.bat。
pause
exit /b 1
