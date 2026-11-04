# Windows 1.0 遠端主機版

成品：`release/Labu-Toy-City-1.0.1-Windows.exe`，Windows x64 免安裝。雙擊即可開啟，內含遊戲、房間主機及加密通道，不需要另裝 Node.js。

完整操作步驟見 [遠端遊玩說明](FINAL_REMOTE_GUIDE.md)。從「多人遊戲 → 遠端連線 → 建立房間」開啟主機，再複製房間邀請連結；朋友可使用網址或自己的 App 加入。分享時可明確按「只開主機，縮到背景」維持主機，按 X 可選擇關閉程式、背景執行或取消，不需要親自參賽。

USB／藍牙沿用目前 C Plus 韌體，不必因桌面版更新而重新燒錄。若舊視窗已連接裝置，先中斷舊連線再換到新版本。

桌面版存檔與瀏覽器各自獨立，可透過設定的匯出／匯入搬移離線進度。多人房間只保留在本次主機程序記憶體中，主機結束後不會永久保存。

從原始碼重建：`npm ci` 後執行 `npm run desktop:pack`。首次會下載官方 Electron、封裝工具和固定版本的 Cloudflared，後者會驗證官方 SHA256。請只開一個版本的桌面 App，以免本機服務連接埠重複。

驗證腳本：`scripts/test-final-desktop.cjs`（完整外網雙人流程）、`scripts/test-desktop.cjs`（棋盤及裝置選擇）、`scripts/test-portable.ps1`（單檔 EXE 解壓啟動）。測試會自行停止其開啟的分享通道。
