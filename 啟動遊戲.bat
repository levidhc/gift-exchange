@echo off
chcp 65001 >nul
title 禮物心機猜猜樂 - 交換禮物遊戲程式
echo ========================================================
echo  🎁 禮物心機猜猜樂 (Gift Guess & Swap) 伺服器啟動中...
echo ========================================================
echo.
echo 正在為您開啟瀏覽器...
start http://localhost:8000
echo.
python app.py
pause
