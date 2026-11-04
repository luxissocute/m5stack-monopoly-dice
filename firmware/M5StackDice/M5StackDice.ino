#include <M5Unified.h>
#include <math.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>

// Acceleration is in g. Tune these on your actual IMU.
constexpr float SHAKE_G = 1.8f;
constexpr float QUIET_G = 0.20f;
constexpr uint32_t QUIET_MS = 650;
constexpr uint32_t COOLDOWN_MS = 1200;
String session, input;
uint32_t sequence = 0, lastShake = 0, quietSince = 0, lastHost = 0;
bool armed = false, shaking = false, imuOK = false;
bool ownerBle = false;
volatile bool bleConnected = false;
volatile bool bleNeedsAdvertising = false;
BLECharacteristic* bleTx = nullptr;
QueueHandle_t bleCommands;
struct BleCommand { char line[100]; };

void sendLine(const String& line) {
  if (!ownerBle) { Serial.println(line); return; }
  if (!bleConnected) return;
  const String packet = line + "\n";
  for (size_t i = 0; i < packet.length(); i += 20) {
    String chunk = packet.substring(i, i + 20);
    bleTx->setValue((uint8_t*)chunk.c_str(), chunk.length());
    bleTx->notify();
    delay(8);
  }
}
void acceptSession(String line, bool fromBle) {
  if (!line.startsWith("SESSION ") || line.length() >= 64) return;
  const uint32_t now = millis();
  // A live transport owns the device until disconnected or its lease expires.
  if (!session.isEmpty() && ownerBle != fromBle && now - lastHost <= 2500) return;
  String token = line.substring(8); token.trim();
  if (token.isEmpty()) return;
  if (token != session || ownerBle != fromBle) {
    session = token; sequence = 0; armed = false; shaking = false; quietSince = 0;
  }
  ownerBle = fromBle; lastHost = now;
  sendLine(imuOK ? "READY " + session : "ERROR NO_IMU");
}
class DiceServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConnected = true; }
  void onDisconnect(BLEServer*) override { bleConnected = false; bleNeedsAdvertising = true; }
};
class DiceRxCallbacks : public BLECharacteristicCallbacks {
  String pending;
  void onWrite(BLECharacteristic* characteristic) override {
    const std::string value = characteristic->getValue();
    for (const char c : value) {
      if (c == '\n') {
        BleCommand command = {};
        pending.toCharArray(command.line, sizeof(command.line));
        xQueueSend(bleCommands, &command, 0);
        pending = "";
      } else if (pending.length() < 99) pending += c;
      else pending = "";
    }
  }
};

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);
  imuOK = M5.Imu.isEnabled();
  M5.Display.setRotation(1);
  M5.Display.setTextSize(2);
  M5.Display.println(imuOK ? "Labu Dice\nBluetooth / USB" : "NO IMU\nCheck device model");
  bleCommands = xQueueCreate(8, sizeof(BleCommand));
  BLEDevice::init("Labu Dice");
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new DiceServerCallbacks());
  BLEService* service = server->createService("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
  bleTx = service->createCharacteristic("6e400003-b5a3-f393-e0a9-e50e24dcca9e", BLECharacteristic::PROPERTY_NOTIFY);
  bleTx->addDescriptor(new BLE2902());
  auto rx = service->createCharacteristic("6e400002-b5a3-f393-e0a9-e50e24dcca9e", BLECharacteristic::PROPERTY_WRITE);
  rx->setCallbacks(new DiceRxCallbacks());
  service->start();
  auto advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(service->getUUID());
  advertising->setScanResponse(true);
  advertising->start();
}

void loop() {
  M5.update();
  if (bleNeedsAdvertising) {
    bleNeedsAdvertising = false;
    if (ownerBle) { session = ""; armed = false; shaking = false; quietSince = 0; }
    xQueueReset(bleCommands);
    BLEDevice::startAdvertising();
  }
  BleCommand command;
  while (xQueueReceive(bleCommands, &command, 0) == pdTRUE) {
    if (bleConnected) acceptSession(String(command.line), true);
  }
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\n') {
      acceptSession(input, false);
      input = "";
    } else if (input.length() < 100) input += c;
    else input = "";
  }
  // Session handling can take time (BLE notifications). Sample now afterwards
  // so unsigned subtraction cannot underflow against a newer lastHost.
  const uint32_t now = millis();
  if (!imuOK || session.isEmpty() || now - lastHost > 2500) {
    armed = false; shaking = false; quietSince = 0; delay(10); return;
  }
  if (M5.Imu.update()) {
    const auto data = M5.Imu.getImuData();
    const float magnitude = sqrtf(data.accel.x * data.accel.x + data.accel.y * data.accel.y + data.accel.z * data.accel.z);
    const float motion = fabsf(magnitude - 1.0f);
    if (motion < QUIET_G) {
      if (!quietSince) quietSince = now;
      if (now - quietSince >= QUIET_MS) {
        if (shaking) {
          // Commit only after the whole gesture has stopped. Repeated peaks
          // during the gesture never send a roll to the game.
          shaking = false; armed = false; quietSince = 0; lastShake = now;
          sendLine("SHAKE " + session + " " + String(sequence));
          M5.Display.fillScreen(TFT_BLACK);
          M5.Display.setCursor(0, 0);
          M5.Display.printf("Roll sent: %lu\nWait, then shake", (unsigned long)sequence);
        } else if (now - lastShake >= COOLDOWN_MS) armed = true;
      }
    } else quietSince = 0;
    if (armed && motion > SHAKE_G) {
      armed = false; shaking = true; quietSince = 0;
      sendLine("SHAKING " + session + " " + String(++sequence));
      M5.Display.fillScreen(TFT_BLACK);
      M5.Display.setCursor(0, 0);
      M5.Display.println("Shaking...\nStop to roll!");
    }
  }
  delay(10);
}
