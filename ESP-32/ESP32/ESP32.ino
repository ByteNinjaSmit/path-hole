
#define BLYNK_TEMPLATE_ID "TMPL3plD6da5q"
#define BLYNK_TEMPLATE_NAME "PathHole"
#define BLYNK_AUTH_TOKEN "owY6aFef2hrWdORtAIATfg8-0K_hI3I8"

#include <Wire.h>
#include <WiFi.h>
#include <BlynkSimpleEsp32.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

// -------------------- WiFi --------------------
char ssid[] = "iot";
char pass[] = "110110110";

// -------------------- Motor Driver Pins --------------------
const int IN1 = 14;
const int IN2 = 27;
const int ENA = 26;
const int IN3 = 25;
const int IN4 = 33;
const int ENB = 32;

// -------------------- Sensors --------------------
const int VIB_PIN = 34;
const int BUZZER_PIN = 12;

// -------------------- MPU6050 --------------------
Adafruit_MPU6050 mpu;

// -------------------- States --------------------
bool forwardEnabled = false;
bool reverseEnabled = false;
bool buzzerOn = false;
unsigned long lastBuzzTime = 0;
const unsigned long buzzDuration = 2000;  // 2 seconds
const unsigned long buzzCooldown = 3000;  // minimum time between buzzes
BlynkTimer timer;

// -------------------- Function Declarations --------------------
void connectToWiFi();
void connectToBlynk();
void initializeMPU();
void initializeMotors();
void stopMotors();
void driveMotorA(int speed);
void driveMotorB(int speed);
void sendSensorData();

// =============================================================
// SETUP
// =============================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n🚀 Starting PathHole Detection System...");
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);

  connectToWiFi();
  connectToBlynk();
  initializeMotors();
  initializeMPU();

  pinMode(VIB_PIN, INPUT);

  timer.setInterval(500L, sendSensorData);

  Serial.println("\n✅ System Setup Complete. Waiting for commands...");
}

// =============================================================
// MAIN LOOP
// =============================================================
void loop() {
  Blynk.run();
  timer.run();

  // -----------------------------
  // Read and smooth MPU6050 Z-axis
  // -----------------------------
  float zSum = 0;
  for (int i = 0; i < 5; i++) {
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    zSum += a.acceleration.z;
    delay(5);
  }
  float zAccel = zSum / 5.0;

  // -----------------------------
  // Define thresholds
  // -----------------------------
  const float POTHOLE_THRESHOLD = -9.89;
  const float RESET_THRESHOLD = -9.93;

  // -----------------------------
  // Ignore unreal sensor glitches
  // -----------------------------
  if (zAccel > -8.0 || zAccel < -11.0) {
    Serial.print("⚠️ Ignored spike/glitch Z = ");
    Serial.println(zAccel);
  } else {
    // -----------------------------
    // Pothole detection logic
    // -----------------------------
    if (!buzzerOn && zAccel > POTHOLE_THRESHOLD && (millis() - lastBuzzTime > buzzCooldown)) {
      buzzerOn = true;
      lastBuzzTime = millis();
      Serial.print("🚨 Pothole Detected! Buzzer ON | Z = ");
      Serial.println(zAccel);
      digitalWrite(BUZZER_PIN, HIGH);
    }

    if (buzzerOn && ((millis() - lastBuzzTime > buzzDuration) || (zAccel < RESET_THRESHOLD))) {
      buzzerOn = false;
      digitalWrite(BUZZER_PIN, LOW);
      Serial.print("✅ Buzzer OFF | Z = ");
      Serial.println(zAccel);
    }
  }

  // -----------------------------
  // Motor Control Logic
  // -----------------------------
  if (forwardEnabled) {
    driveMotorA(200);
    driveMotorB(220);
  } else if (reverseEnabled) {
    driveMotorA(-150);
    driveMotorB(-160);
  } else {
    stopMotors();
  }
}

// =============================================================
// BLYNK HANDLERS
// =============================================================
BLYNK_WRITE(V0) {
  int value = param.asInt();
  forwardEnabled = value;
  if (value==1) {
    reverseEnabled = false;
    Blynk.virtualWrite(V4, 0);
    Serial.println("▶️ Motor FORWARD");
  } else {
    stopMotors();
    Serial.println("⏹️ Forward OFF");
  }
}

BLYNK_WRITE(V4) {
  Serial.println("🔹 V4 triggered!");
  int value = param.asInt();
  reverseEnabled = value;
  if (value) {
    forwardEnabled = false;
    Blynk.virtualWrite(V0, 0);
    Serial.println("◀️ Motor REVERSE");
  } else {
    stopMotors();
    Serial.println("⏹️ Reverse OFF");
  }
}


// =============================================================
// WIFI CONNECTION
// =============================================================
void connectToWiFi() {
  Serial.print("🔌 Connecting to WiFi: ");
  Serial.println(ssid);
  WiFi.begin(ssid, pass);

  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi Connected!");
    Serial.print("📶 IP: ");
    Serial.println(WiFi.localIP());

    // Two short beeps
    for (int i = 0; i < 2; i++) {
      digitalWrite(BUZZER_PIN, HIGH);
      delay(100);
      digitalWrite(BUZZER_PIN, LOW);
      delay(100);
    }
  } else {
    Serial.println("\n❌ WiFi Failed! Restarting...");
    ESP.restart();
  }
}

// =============================================================
// BLYNK CONNECTION
// =============================================================
void connectToBlynk() {
  Serial.println("🌐 Connecting to Blynk Cloud...");
  Blynk.begin(BLYNK_AUTH_TOKEN, ssid, pass);

  int attempts = 0;
  while (!Blynk.connected() && attempts < 15) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (Blynk.connected()) {
    Serial.println("\n✅ Connected to Blynk Cloud!");
  } else {
    Serial.println("\n⚠️ Blynk Timeout! Restarting...");
    ESP.restart();
  }
}

// =============================================================
// MPU6050 INITIALIZATION
// =============================================================
void initializeMPU() {
  Wire.begin(21, 22);
  if (!mpu.begin()) {
    Serial.println("❌ MPU6050 not found! Check wiring...");
    while (1) delay(1000);
  }

  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  Serial.println("✅ MPU6050 initialized!");
}

// =============================================================
// MOTOR CONTROL
// =============================================================
void initializeMotors() {
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(ENA, OUTPUT);
  pinMode(ENB, OUTPUT);
  stopMotors();
}

void driveMotorA(int speed) {
  if (speed > 0) {
    digitalWrite(IN1, HIGH);
    digitalWrite(IN2, LOW);
    analogWrite(ENA, speed);
  } else if (speed < 0) {
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, HIGH);
    analogWrite(ENA, -speed);
  } else {
    digitalWrite(IN1, LOW);
    digitalWrite(IN2, LOW);
    analogWrite(ENA, 0);
  }
}

void driveMotorB(int speed) {
  if (speed > 0) {
    digitalWrite(IN3, HIGH);
    digitalWrite(IN4, LOW);
    analogWrite(ENB, speed);
  } else if (speed < 0) {
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, HIGH);
    analogWrite(ENB, -speed);
  } else {
    digitalWrite(IN3, LOW);
    digitalWrite(IN4, LOW);
    analogWrite(ENB, 0);
  }
}

void stopMotors() {
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  analogWrite(ENA, 0);
  analogWrite(ENB, 0);
}

// =============================================================
// SEND SENSOR DATA
// =============================================================
void sendSensorData() {
  sensors_event_t a, g, temp;
  mpu.getEvent(&a, &g, &temp);

  float zAccel = a.acceleration.z;
  float gyroZ = g.gyro.z;
  int vibState = digitalRead(VIB_PIN);

  Blynk.virtualWrite(V1, zAccel);
  Blynk.virtualWrite(V2, vibState);
  Blynk.virtualWrite(V3, gyroZ);

  // Serial.print("📊 Accel Z: ");
  // Serial.print(zAccel);
  // Serial.print(" | Gyro Z: ");
  // Serial.print(gyroZ);
  // Serial.print(" | Vibration: ");
  // Serial.println(vibState);
}
