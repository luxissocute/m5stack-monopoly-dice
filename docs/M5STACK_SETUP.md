# M5Stack 搖動骰子：安裝與繳交

本專案以老師提供的 RichTsai1688/Labu-monopoly-m5stack 為基礎，加入 USB Web Serial。原線上預覽不會因為本機修改而更新，請使用本機版或另行部署此版本。

## 1. 啟動遊戲

安裝 Node.js 22 以上，在專案資料夾執行：

```powershell
npm ci
npm run dev
```

以電腦 Chrome 或 Edge 開啟 http://127.0.0.1:5173/game 。多人遊戲另開終端執行 `npm run rooms`，在每位玩家的瀏覽器中加入同一房間。每個瀏覽器連接自己玩家的裝置；房間服務仍驗證身分與回合。

## 2. 上傳裝置程式

### 無線遊玩（藍牙）

新版韌體同時提供 USB 與 BLE。首次更新仍需 USB 上傳，之後可用 C Plus 的內建電池遊玩。

1. 開啟電腦藍牙，讓 C Plus 保持開機並有電。
2. 用電腦 Chrome／Edge 開啟遊戲；若目前走 USB，先按「中斷裝置」。
3. 按「藍牙連線」，選 **Labu Dice**。無需先在 Windows 設定中配對，也不需要 Wi-Fi 密碼。
4. 等上方顯示「M5Stack 已連線（藍牙，可拔線）」後拔掉 USB。
5. 若拔線後裝置關機，按一下電源鍵開機，再從網頁連接藍牙；電量不足時先充電。
6. 原本的回合限制、搖動動畫及停止後出點數規則相同。斷線時取消動畫，不補發舊事件；按「藍牙連線」重新選裝置。

USB 與藍牙共用同一個裝置控制權；換方式前先中斷舊連線，等約 3 秒讓控制權釋放。瀏覽器必須支援 Web Bluetooth，內嵌瀏覽器是否能選藍牙裝置仍需現場確認；優先使用完整 Chrome／Edge。

傳輸使用 BLE UART 服務與 20-byte 分段，沿用 session token、序號及心跳檢查。參考：[Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth)、[C Plus 電池與電源說明](https://docs.m5stack.com/en/core/StickC-Plus)。

本次接上的裝置為 M5StickC Plus，Windows 連接埠 COM3，已讀到 ESP32-PICO-D4。使用 Espressif ESP32 core 2.0.17 的 `esp32:esp32:m5stick-c` 板型，M5Unified 會辨識 Plus 的螢幕與感測器。選 UploadSpeed 115200；安裝版本為 M5Unified 0.2.13、M5GFX 0.2.19。

可重複使用的命令（若 arduino-cli 不在 PATH，請使用 Arduino IDE 內的完整執行檔路徑）：

```powershell
arduino-cli compile --fqbn esp32:esp32:m5stick-c:UploadSpeed=115200 --build-path .runtime/m5stickc-build firmware/M5StackDice
arduino-cli upload --fqbn esp32:esp32:m5stick-c:UploadSpeed=115200 --port COM3 --input-dir .runtime/m5stickc-build firmware/M5StackDice
```

上傳後可用 `powershell -File scripts/check-m5-dice.ps1 -Port COM3` 驗證韌體握手與 IMU；執行時先中斷網頁的裝置連線，測完才回網頁重新連線。

1. 確認型號有 IMU，例如 Core2。Basic 等機種不一定有 IMU；無 IMU 會顯示 NO IMU，必須換用有支援的裝置或另行實作外接感測器。
2. 在 Arduino IDE 安裝適合該機種的 ESP32／M5Stack 開發板套件、M5Unified 與 M5GFX 函式庫，依該機種官方指引選擇板子與 USB 設定。
3. 開啟 `firmware/M5StackDice/M5StackDice.ino`，選擇裝置與連接埠，上傳。這份韌體以 M5Unified API 編寫，已在本次 M5StickC Plus 上編譯、燒錄並確認真實搖動可觸發遊戲。
4. 關閉 Arduino 序列監控視窗（否則遊戲無法使用同一個連接埠）。
5. 遊戲開始後，按上方「連接 M5Stack」，在瀏覽器選擇裝置連接埠。顯示「M5Stack 已連線」才代表韌體握手成功。
6. 先靜止至少 0.65 秒，再明顯搖動；裝置顯示「Shaking... Stop to roll!」，網頁同步持續播放骰子翻動動畫。停止並穩定 0.65 秒後才送出一次擲骰，網頁立即停止翻動並顯示最終點數，裝置顯示「Roll sent」。每次事件後至少間隔 1.2 秒。USB 線需能傳資料，別在搖動時扯到接頭。

不支援 Web Serial 的瀏覽器會提示改用電腦 Chrome／Edge。正式部署須 HTTPS；localhost 可直接使用。手機支援須另行確認，本版以電腦 USB 為驗收環境。

## 3. 防重複與合法擲骰

- 三軸加速度取向量長度，與重力 1g 的差超過 1.8g 時開始記錄一次搖動；回到差值 0.20g 內持續 650ms 後才送出擲骰。連續搖動不重複發送；換回合、斷線時取消尚未送出的搖動。閾值集中在韌體頂端，可依實機調校。
- 裝置每 10ms 讀取 IMU，只傳搖動事件，不傳骰點。
- 瀏覽器透過 `SESSION <token>` 配對，裝置回覆 `READY <token>`。開始搖動傳 `SHAKING <token> <sequence>` 播放持續動畫；停止後傳同序號的 `SHAKE <token> <sequence>`，這時才產生點數，直接呈現結果，不重播原本固定長度的動畫。每次連線、換回合／可操作狀態改變均換 token；同序號不重送，舊事件不補發。
- 韌體超過 2.5 秒沒收到瀏覽器心跳便停止送事件。重複 SESSION 不重置序號或偵測器。
- 只有本人回合、擲骰階段、未暫停、前景頁面且未開啟選項視窗時允許搖動擲骰。按鈕和硬體共用 requestRoll，等待房間回應時鎖住重複請求。
- 搖動永遠只請求 roll，不會按到「結束回合」。骰數、點數與多人驗證仍走既有引擎／伺服器。
- 單機連接時配對目前人類玩家（若為 NPC 回合，配對第一位人類）；上方會顯示配對名稱。其他人類回合不接受此裝置，欲換人請中斷後在該玩家回合重連。多人實測請用不同瀏覽器或電腦，並在各自席位連接裝置。

## 4. 實機驗收與錄影腳本（約 60–90 秒）

以下為待執行項目，請以真實結果填寫，不要當作已驗收。

| 畫面／操作 | 應看到的結果 | 實測結果 |
|---|---|---|
| 拍到 M5Stack 型號、USB 與遊戲連線提示 | 完成握手 | 待測 |
| 本人回合持續搖動，再停止 | 搖動中不擲骰；穩定 0.65 秒後只擲一次、角色移動 | 待測 |
| 其他玩家回合搖動 | 沒有擲骰 | 待測 |
| 抵達後再次搖動 | 不會自動結束回合 | 待測 |
| 暫停／選項視窗／背景頁面搖動 | 不會擲骰，回復後不補發 | 待測 |
| 拔 USB，再按螢幕擲骰 | 按鈕正常運作 | 待測 |
| 重新連線，靜止後再搖動 | 可繼續玩，沒有重播舊事件 | 待測 |
| 步行與換車後各擲一次 | 骰數符合原遊戲交通工具規則 | 待測 |
| 兩個真人席位連線，觀察雙方畫面 | 當前玩家正確、結果同步 | 待測 |

錄影請同時拍到手持硬體與遊戲畫面，可用手機拍整個操作，或 OBS 加攝影機。最後交付短片、此專案與填寫後的驗收表。此處沒有代錄實機影片。

參考：[老師提供的程式](https://github.com/RichTsai1688/Labu-monopoly-m5stack)、[M5Unified IMU](https://docs.m5stack.com/en/arduino/m5unified/imu_class)、[Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)。
