# M5Stack 整合驗證紀錄

日期：2026-10-29（Asia/Taipei）

## 藍牙擴充

新增 BLE UART 與「藍牙連線」按鈕，沿用 USB 的 session／序號／回合限制和搖動動畫。電腦 Realtek Bluetooth Adapter 狀態正常。網頁 TypeScript、正式版建置、5 項協定與 BLE 串流測試通過；3 項 Chrome 流程通過（含模擬藍牙通知分段、搖動／停止、無線斷開）。最新雙模式韌體編譯成功（1261773 bytes），已透過 COM3 燒錄、雜湊校驗成功，並通過實機 USB 握手與 IMU 啟用檢查。真實藍牙配對、拔線供電與搖動仍須使用者現場確認；模擬測試不等於無線實機驗收。

最新韌體行為：開始搖動時傳 SHAKING，網頁立即持續播放骰子翻動；停止並穩定 650ms 後傳 SHAKE，才執行 roll，直接顯示最終點數，不再重播原有固定動畫。新版已完成 C Plus 編譯（433269 bytes）、COM3 燒錄與雜湊驗證；手持動畫同步仍待使用者實測。

本次網頁驗證：TypeScript 與正式版建置通過；4 項序列協定測試通過；Chrome 驗證搖動超過 2.6 秒仍持續動畫、停止前不產生點數、停止後最終結果不帶延遲動畫、非本人席位不擲骰，以及開啟選項視窗取消動畫並阻擋補發。

基底：[RichTsai1688/Labu-monopoly-m5stack](https://github.com/RichTsai1688/Labu-monopoly-m5stack)，commit `3788a16e0fc436713556ad231d707a3d540dc1ff`。

## 已執行

- TypeScript：`node node_modules/typescript/bin/tsc --noEmit` 通過。
- 正式版：`node node_modules/vite/bin/vite.js build` 通過；原有 Three.js 分包有體積警告。
- 單元與伺服器：`node node_modules/vitest/vitest.mjs run`，16 個檔案、141 項測試全部通過。包含裝置握手／舊 token／重複序號及既有多人房間權限測試。
- Chrome：`node node_modules/@playwright/test/cli.js test tests/m5-dice.spec.ts`，2 項通過。使用模擬 Web Serial 串流，涵蓋拆包、同事件重複輸入、實際觸發遊戲 roll、抵達後不結束回合、同桌另一位真人回合不能搖動、選項視窗阻擋，以及斷開後按鈕仍可操作。
- 檢視桌面與手機寬度截圖；新增裝置列可換行。手機原有浮動聊天介面會遮到上方控制列，本版硬體驗收環境為電腦 Chrome／Edge。

最初測試受到執行環境的 localhost EACCES 限制；取得權限後重跑已通過。Playwright 啟動命令改為直接執行 Vite，以支援只有 Node、沒有 npm 命令的測試環境。

## 尚未驗證

### 後續實機更新

已用 M5StickC Plus（ESP32-PICO-D4，COM3）完成編譯、115200 燒錄及韌體握手，IMU 啟用檢查通過。修正 Web Serial 開啟後釋放 DTR／RTS 控制訊號，解決 USB 已開啟但韌體未回應的情況；新增對應模擬重置訊號的 Chrome 測試，兩項流程通過。使用者於 2026-10-29 回報「M5Stack 已連線」並實際搖動後「已擲骰，角色開始移動」。

因此下列原始限制中的「未編譯／燒錄」已解除；完整實機驗收表及錄影仍待完成。

- 沒有連接實體 M5Stack；韌體尚未編譯、燒錄，也沒有實機加速度樣本。各機種 USB CDC、IMU 與函式庫設定需依型號確認。
- 閾值及靜止判定需實機調校；目前測試不構成硬體感測器驗收。
- 沒有實機影片，也沒有更新老師原線上網站或推送 GitHub。
- 沒有執行全部既有 Playwright 測試，已執行本次整合的兩項流程。

後續依 [安裝與錄影指南](M5STACK_SETUP.md) 完成實機驗收表，再提交短片。
