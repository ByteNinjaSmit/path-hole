#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

const char* WIFI_SSID = "iot";
const char* WIFI_PASS = "110110110";

const char* WS_HOST = "10.15.82.112"; // set to your server IP
const int   WS_PORT = 8080;
const char* WS_PATH = "/ws";
const bool  USE_SSL = false;

WebSocketsClient webSocket;
Adafruit_MPU6050 mpu;
const float WHEEL_D_CM = 6.5;
const float REF_WHEEL_D_CM = 10.0;
const float SENSITIVITY_GAIN = 3.5;
const float WHEEL_CIRC_M = (WHEEL_D_CM / 100.0f) * 3.1415926f;

const float G0 = 9.80665f;
float gyroBiasX = 0, gyroBiasY = 0, gyroBiasZ = 0;
float accelBiasX = 0, accelBiasY = 0, accelBiasZ = 0;

float distanceMeters = 0.0f;
float estSpeedMps = 0.0f;
unsigned long lastMotionMs = 0;

float headingDeg = 0.0f;
float posX = 0.0f;
float posY = 0.0f;

bool autoMode = false;
int autoSpeed = 0;

struct Waypoint {
  float x;
  float y;
};

Waypoint route[500];
int routeLen = 0;
int routeIndex = 0;

float filterLowPass(float prev, float current, float alpha){
  return alpha * current + (1.0f - alpha) * prev;
}

// L298N pins (match your wiring)
const int IN1 = 14;
const int IN2 = 27;
const int ENA = 26;
const int IN3 = 25;
const int IN4 = 33;
const int ENB = 32;
const int BUZZER_PIN = 12; // active buzzer

int speedL = 0, speedR = 0;
volatile bool wsConnected = false;
bool motorsReady = false;
unsigned long lastCmdMs = 0; // failsafe timer for motor commands

void beep(int onMs, int offMs, int times){
  for(int i=0;i<times;i++){
    digitalWrite(BUZZER_PIN, HIGH);
    delay(onMs);
    digitalWrite(BUZZER_PIN, LOW);
    if (i<times-1) delay(offMs);
  }
}

void calibrateIMU(unsigned int n){
  sensors_event_t a, g, t;
  float sx=0, sy=0, sz=0, ax=0, ay=0, az=0;
  for (unsigned int i=0; i<n; ++i){
    mpu.getEvent(&a, &g, &t);
    sx += g.gyro.x; sy += g.gyro.y; sz += g.gyro.z;
    ax += a.acceleration.x; ay += a.acceleration.y; az += a.acceleration.z;
    delay(5);
  }
  float inv = 1.0f / (float)n;
  gyroBiasX = sx * inv; gyroBiasY = sy * inv; gyroBiasZ = sz * inv;
  accelBiasX = ax * inv; accelBiasY = ay * inv; accelBiasZ = (az * inv) - G0;
}

void setMotor(int l, int r, const String& dir){
  if (!motorsReady) return;
  if (dir == "forward") {
    digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
    digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
  } else if (dir == "reverse") {
    digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);
    digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH);
  } else if (dir == "left") {
    digitalWrite(IN1, LOW); digitalWrite(IN2, HIGH);
    digitalWrite(IN3, HIGH); digitalWrite(IN4, LOW);
  } else if (dir == "right") {
    digitalWrite(IN1, HIGH); digitalWrite(IN2, LOW);
    digitalWrite(IN3, LOW); digitalWrite(IN4, HIGH);
  } else { // stop
    digitalWrite(IN1, LOW); digitalWrite(IN2, LOW);
    digitalWrite(IN3, LOW); digitalWrite(IN4, LOW);
    l = r = 0;
  }
  analogWrite(ENA, constrain(l,0,255));
  analogWrite(ENB, constrain(r,0,255));
  speedL = l; speedR = r;
  lastMotionMs = millis();
}

void stopMotors(){
  if (!motorsReady) return;
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  analogWrite(ENA, 0);
  analogWrite(ENB, 0);
}

void initMotors(){
  pinMode(IN1,OUTPUT); pinMode(IN2,OUTPUT); pinMode(IN3,OUTPUT); pinMode(IN4,OUTPUT);
  pinMode(ENA, OUTPUT); pinMode(ENB, OUTPUT);
  analogWrite(ENA, 0); analogWrite(ENB, 0);
  digitalWrite(IN1, LOW); digitalWrite(IN2, LOW); digitalWrite(IN3, LOW); digitalWrite(IN4, LOW);
  motorsReady = true;
  // beep once to indicate motors ready
  beep(100, 0, 1);
}

void wsEvent(WStype_t type, uint8_t * payload, size_t length){
  if (type == WStype_CONNECTED) {
    wsConnected = true;
    StaticJsonDocument<256> doc;
    doc["type"] = "hello"; doc["source"] = "esp32"; doc["ts"] = millis();
    JsonObject d = doc.createNestedObject("data"); d["role"] = "esp32"; d["deviceId"] = "esp32-01";
    String out; serializeJson(doc, out); webSocket.sendTXT(out);
    // 3 short beeps to indicate WS connected
    beep(80, 80, 3);
  } else if (type == WStype_TEXT) {
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) return;
    const char* t = doc["type"];
    if (t && strcmp(t, "motorControl") == 0) {
      autoMode = false;
      JsonObject data = doc["data"];
      int l = data["speedLeft"] | 0;
      int r = data["speedRight"] | 0;
      String dir = data["direction"].as<String>();
      setMotor(l, r, dir);
      lastCmdMs = millis();
    } else if (t && strcmp(t, "autoDrive") == 0) {
      JsonObject data = doc["data"];
      autoSpeed = data["speed"] | 120;
      JsonArray path = data["path"].as<JsonArray>();
      routeLen = 0;
      for (JsonVariant p : path){
        if (routeLen >= 500) break;
        route[routeLen].x = p["x"] | 0.0f;
        route[routeLen].y = p["y"] | 0.0f;
        routeLen++;
      }
      routeIndex = 0;
      autoMode = routeLen > 0;
    } else if (t && strcmp(t, "pathCommand") == 0) {
      JsonArray path = doc["data"]["path"].as<JsonArray>();
      routeLen = 0;
      for (JsonVariant p : path){
        if (routeLen >= 500) break;
        route[routeLen].x = p["x"] | 0.0f;
        route[routeLen].y = p["y"] | 0.0f;
        routeLen++;
      }
      routeIndex = 0;
      autoSpeed = 120;
      autoMode = routeLen > 0;
    } else if (t && strcmp(t, "ping") == 0) {
      StaticJsonDocument<128> pong;
      pong["type"] = "pong"; pong["source"] = "esp32"; pong["ts"] = millis();
      String out; serializeJson(pong, out); webSocket.sendTXT(out);
    }
  }
}

void sendTelemetry(){
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);

  static float zPrev = 0;
  float jerkZ = fabs(a.acceleration.z - zPrev);
  zPrev = a.acceleration.z;

  static float gxF = 0, gyF = 0, gzF = 0, axF = 0, ayF = 0, azF = 9.80665f;

  static unsigned long lastDtMs = millis();
  unsigned long now = millis();
  float dt = (now - lastDtMs) / 1000.0f;
  if (dt < 0 || dt > 0.5f) dt = 0.0f;
  lastDtMs = now;

  int pwmAvg = (speedL + speedR) / 2;
  const float PWM_TO_MPS = 0.01f;
  float vPwm = pwmAvg * PWM_TO_MPS;

  // If motors are essentially stopped and accel along X is tiny, force speed to 0 to avoid drift
  const int PWM_DEADBAND = 5;
  const float ACCEL_DEADBAND = 0.25f;

  float axAdj = a.acceleration.x - accelBiasX;
  float ayAdj = a.acceleration.y - accelBiasY;
  float azAdj = a.acceleration.z - accelBiasZ;
  float gxAdj = g.gyro.x - gyroBiasX;
  float gyAdj = g.gyro.y - gyroBiasY;
  float gzAdj = g.gyro.z - gyroBiasZ;

  if (abs(pwmAvg) <= PWM_DEADBAND && fabs(axAdj) < ACCEL_DEADBAND) {
    estSpeedMps = 0.0f;
  } else {
    float vAccel = estSpeedMps + axAdj * dt;
    vAccel = filterLowPass(estSpeedMps, vAccel, 0.3f);
    float vCombined = 0.8f * vPwm + 0.2f * vAccel;
    estSpeedMps = filterLowPass(estSpeedMps, vCombined, 0.2f);
  }

  if (dt > 0.0f && fabs(estSpeedMps) > 0.001f){
    distanceMeters += estSpeedMps * dt;
  }

  float gxDps = gxAdj * 57.2958f;
  float gyDps = gyAdj * 57.2958f;
  float gzDps = gzAdj * 57.2958f;
  gxF = filterLowPass(gxF, gxDps, 0.12f);
  gyF = filterLowPass(gyF, gyDps, 0.12f);
  gzF = filterLowPass(gzF, gzDps, 0.12f);
  axF = filterLowPass(axF, axAdj, 0.12f);
  ayF = filterLowPass(ayF, ayAdj, 0.12f);
  azF = filterLowPass(azF, azAdj, 0.12f);

  float gyroMag = sqrtf(gxF*gxF + gyF*gyF + gzF*gzF);
  float accMag = sqrtf(axF*axF + ayF*ayF + azF*azF);
  bool stationary = (abs(pwmAvg) <= 5) && (gyroMag < 1.5f) && (fabs(accMag - G0) < 0.6f);

  const float GYRO_FLOOR = 0.6f;
  const float ACC_FLOOR = 0.08f;
  float gxOut = stationary ? 0.0f : (fabs(gxF) < GYRO_FLOOR ? 0.0f : gxF);
  float gyOut = stationary ? 0.0f : (fabs(gyF) < GYRO_FLOOR ? 0.0f : gyF);
  float gzOut = stationary ? 0.0f : (fabs(gzF) < GYRO_FLOOR ? 0.0f : gzF);
  float axOut = stationary ? 0.0f : (fabs(axF) < ACC_FLOOR ? 0.0f : axF);
  float ayOut = stationary ? 0.0f : (fabs(ayF) < ACC_FLOOR ? 0.0f : ayF);
  float azOut = stationary ? G0 : (fabs(azF - G0) < ACC_FLOOR ? G0 : azF);

  headingDeg += gzOut * dt;
  if (headingDeg >= 360.0f) headingDeg -= 360.0f;
  if (headingDeg < 0.0f) headingDeg += 360.0f;

  float dx = estSpeedMps * dt * cosf(headingDeg * 0.0174533f);
  float dy = estSpeedMps * dt * sinf(headingDeg * 0.0174533f);
  posX += dx;
  posY += dy;

  StaticJsonDocument<320> doc;
  doc["type"] = "telemetry"; doc["source"] = "esp32"; doc["ts"] = millis();
  JsonObject d = doc.createNestedObject("data");
  d["speedLeft"] = speedL; d["speedRight"] = speedR;
  d["distance"] = distanceMeters;
  d["heading"] = headingDeg;
  d["posX"] = posX;
  d["posY"] = posY;
  JsonObject gyro = d.createNestedObject("gyro");
  gyro["x"] = gxOut;
  gyro["y"] = gyOut;
  gyro["z"] = gzOut;
  JsonObject accel = d.createNestedObject("accel");
  accel["x"] = axOut;
  accel["y"] = ayOut;
  accel["z"] = azOut;
  String out; serializeJson(doc, out); webSocket.sendTXT(out);

  float scale = WHEEL_D_CM / REF_WHEEL_D_CM;
  float thEvent = (7.5f * scale) / SENSITIVITY_GAIN;
  float thMed = (10.0f * scale) / SENSITIVITY_GAIN;
  float thHigh = (15.0f * scale) / SENSITIVITY_GAIN;

  if (jerkZ > thEvent){
    StaticJsonDocument<256> ev;
    ev["type"] = "pothole"; ev["source"] = "esp32"; ev["ts"] = millis();
    JsonObject ed = ev.createNestedObject("data");
    ed["severity"] = (jerkZ>thHigh) ? "high" : (jerkZ>thMed ? "medium":"low");
    ed["value"] = jerkZ;
    ed["posX"] = posX;
    ed["posY"] = posY;
    String out2; serializeJson(ev, out2); webSocket.sendTXT(out2);
    // single longer beep on pothole
    beep(200, 0, 1);
  }
}

void autoNavigate(){
  if (!autoMode || routeLen == 0) return;
  float cx = posX;
  float cy = posY;
  float chead = headingDeg;
  float tx = route[routeIndex].x;
  float ty = route[routeIndex].y;
  float dx = tx - cx;
  float dy = ty - cy;
  float dist = sqrtf(dx*dx + dy*dy);
  if (dist < 0.15f){
    routeIndex++;
    if (routeIndex >= routeLen){
      autoMode = false;
      stopMotors();
      // notify server that the route has completed
      StaticJsonDocument<160> ev;
      ev["type"] = "routeComplete";
      ev["source"] = "esp32";
      ev["ts"] = millis();
      JsonObject d = ev.createNestedObject("data");
      // server will attach routeId based on its currentRouteId
      String out; serializeJson(ev, out); webSocket.sendTXT(out);
      return;
    }
    return;
  }
  float targetAngle = atan2f(dy, dx) * 57.2958f;
  float angleError = targetAngle - chead;
  if (angleError > 180.0f) angleError -= 360.0f;
  if (angleError < -180.0f) angleError += 360.0f;
  int base = autoSpeed;
  int turn = (int)(angleError * 1.8f);
  int left = base - turn;
  int right = base + turn;
  left = constrain(left, 0, 255);
  right = constrain(right, 0, 255);
  setMotor(left, right, "forward");
  lastCmdMs = millis();
}

void setup(){
  Serial.begin(115200);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status()!=WL_CONNECTED) { delay(300); }
  // 2 short beeps on WiFi connected
  beep(100, 100, 2);

  // connect to server (WebSocket) next
  webSocket.onEvent(wsEvent);
  if (USE_SSL) {
    webSocket.beginSSL(WS_HOST, WS_PORT, WS_PATH);
  } else {
    webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  }
  webSocket.setReconnectInterval(2000);

  // wait briefly for WS to connect before proceeding (max 5s)
  unsigned long wsStart = millis();
  while (!wsConnected && millis() - wsStart < 5000) {
    webSocket.loop();
    delay(50);
  }

  // then initialize MPU
  if (!mpu.begin()) { while(1) delay(1000); }
  // 1 short beep on MPU ready
  beep(120, 0, 1);

  mpu.setAccelerometerRange(MPU6050_RANGE_2_G);
  mpu.setGyroRange(MPU6050_RANGE_250_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_5_HZ);
  calibrateIMU(200);

  // finally, initialize motors
  initMotors();
}

unsigned long lastTx = 0;
void loop(){
  webSocket.loop();
  unsigned long now = millis();
  if (autoMode) {
    autoNavigate();
  }
  // failsafe: stop motors if control is stale
  if (lastCmdMs && (now - lastCmdMs > 300)) {
    if (speedL != 0 || speedR != 0) {
      stopMotors();
      speedL = 0; speedR = 0;
    }
    lastCmdMs = 0;
  }
  if (now - lastTx > 50) { lastTx = now; sendTelemetry(); }
}
