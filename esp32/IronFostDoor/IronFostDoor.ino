/* ============================================================================
   IRON FOST GYM — DOOR CONTROLLER
   ESP32 + 1-channel relay + 12V magnetic lock + exit button

   WHAT IT DOES
     - Listens on MQTT. When the gym backend approves a fingerprint it
       publishes "open", and this releases the door for DOOR_OPEN_MS.
     - Watches a physical exit button. Pressing it releases the door for the
       same DOOR_OPEN_MS, with no network involved.
     - Reports what happened back over MQTT so exits show up in the app.

   WIRING (magnetic lock — powered = locked)
     ESP32 5V/VIN  -> relay VCC
     ESP32 GND     -> relay GND
     ESP32 GPIO 26 -> relay IN
     ESP32 GPIO 27 -> exit button, other side of button -> ESP32 GND
     12V +         -> relay COM
     relay NC      -> break-glass COM
     break-glass NC-> maglock +
     maglock -     -> 12V -

   THE BREAK-GLASS UNIT IS NOT OPTIONAL. With a magnetic lock, a dead ESP32
   leaves the relay un-energised, the NC contact closed, the magnet powered and
   the door LOCKED. The break-glass sits in the same power line and cuts it
   mechanically, so people can always get out even if this board is dead.
   ============================================================================ */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>

/* ===== 1. THINGS YOU MUST CHANGE ========================================== */

const char* WIFI_SSID = "IRONFIST";
const char* WIFI_PASS = "your-wifi-password";

const char* MQTT_HOST = "xxxxxxxx.s1.eu.hivemq.cloud";
const int   MQTT_PORT = 8883;
const char* MQTT_USER = "gymadmin";
const char* MQTT_PASS = "your-broker-password";

/* ===== 2. THINGS YOU MAY WANT TO CHANGE =================================== */

// How long the door stays released, in milliseconds. 5000 = 5s, 10000 = 10s.
// Applies to BOTH a fingerprint entry and an exit button press.
const unsigned long DOOR_OPEN_MS = 7000;

const int RELAY_PIN  = 26;   // -> relay IN
const int BUTTON_PIN = 27;   // -> exit button (other leg to GND)

// Most opto-isolated relay boards are ACTIVE LOW: pulling IN low closes the
// relay. If the door behaves backwards, swap these two values.
const int RELAY_ON  = LOW;
const int RELAY_OFF = HIGH;

/* ===== 3. NOTHING BELOW HERE NEEDS EDITING ================================ */

const char* TOPIC_UNLOCK = "gym/door/unlock";
const char* TOPIC_STATUS = "gym/door/status";

const unsigned long DEBOUNCE_MS      = 50;
const unsigned long MQTT_RETRY_MS    = 3000;
const unsigned long WIFI_RETRY_MS    = 10000;

WiFiClientSecure net;
PubSubClient mqtt(net);

// Door state. Tracked with millis() rather than delay() so the button stays
// responsive and MQTT keeps running while the door is open — a delay() here
// would freeze the whole board for the full release time.
bool doorReleased = false;
unsigned long doorReleasedAt = 0;

// Button state, debounced.
int  lastButtonReading = HIGH;
int  stableButtonState = HIGH;
unsigned long lastButtonChange = 0;

unsigned long lastMqttAttempt = 0;
unsigned long lastWifiAttempt = 0;

void releaseDoor(const char* reason) {
  digitalWrite(RELAY_PIN, RELAY_ON);

  // Pressing the button again while the door is already open restarts the
  // timer rather than being ignored, so nobody gets caught by a door that
  // relocks mid-walk.
  doorReleased = true;
  doorReleasedAt = millis();

  Serial.printf("[DOOR] released (%s) for %lu ms\n", reason, DOOR_OPEN_MS);
  if (mqtt.connected()) mqtt.publish(TOPIC_STATUS, reason);
}

void lockDoor() {
  digitalWrite(RELAY_PIN, RELAY_OFF);
  doorReleased = false;
  Serial.println("[DOOR] locked");
  if (mqtt.connected()) mqtt.publish(TOPIC_STATUS, "locked");
}

void onMessage(char* topic, byte* payload, unsigned int len) {
  String msg;
  for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];
  msg.trim();

  Serial.printf("[MQTT] %s -> %s\n", topic, msg.c_str());
  if (msg == "open") releaseDoor("opened_by_fingerprint");
}

// Non-blocking. A blocking reconnect loop would stop the exit button working
// whenever the internet is down, which is exactly when it matters most.
void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiAttempt < WIFI_RETRY_MS) return;
  lastWifiAttempt = millis();
  Serial.println("[WIFI] reconnecting...");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

void ensureMqtt() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqtt.connected()) return;
  if (millis() - lastMqttAttempt < MQTT_RETRY_MS) return;
  lastMqttAttempt = millis();

  String id = "ironfost-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.print("[MQTT] connecting... ");
  if (mqtt.connect(id.c_str(), MQTT_USER, MQTT_PASS)) {
    Serial.println("connected");
    mqtt.subscribe(TOPIC_UNLOCK);
    mqtt.publish(TOPIC_STATUS, "online");
  } else {
    Serial.printf("failed rc=%d\n", mqtt.state());
  }
}

void checkButton() {
  int reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastButtonChange = millis();
    lastButtonReading = reading;
  }

  if (millis() - lastButtonChange < DEBOUNCE_MS) return;

  if (reading != stableButtonState) {
    stableButtonState = reading;
    // INPUT_PULLUP: the pin idles HIGH and the button pulls it to GND, so a
    // press is the HIGH -> LOW edge.
    if (stableButtonState == LOW) releaseDoor("opened_by_exit_button");
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  // Set the pin state BEFORE making it an output, so the relay cannot twitch
  // during boot and flick the door open.
  digitalWrite(RELAY_PIN, RELAY_OFF);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Serial.println("\n=== Iron Fost door controller ===");
  Serial.printf("release time: %lu ms\n", DOOR_OPEN_MS);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  // TODO before this runs a real door: replace with net.setCACert(...) using
  // the broker's root certificate. setInsecure() skips verifying that the
  // server really is your broker.
  net.setInsecure();

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setKeepAlive(30);
}

void loop() {
  ensureWifi();
  ensureMqtt();
  mqtt.loop();

  checkButton();

  if (doorReleased && (millis() - doorReleasedAt >= DOOR_OPEN_MS)) {
    lockDoor();
  }
}
