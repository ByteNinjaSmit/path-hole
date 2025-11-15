"use strict";

const http = require("http");
const WebSocket = require("ws");
const Ajv = require("ajv");

const PORT = process.env.PORT || 8080;

const groups = { esp32: new Set(), dashboard: new Set() };

function json(obj) { return JSON.stringify(obj); }

// Ajv validators
const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });
const envelopeSchema = {
  type: "object",
  required: ["type", "source", "ts", "data"],
  properties: {
    type: { type: "string", enum: ["hello", "telemetry", "motorControl", "status", "pothole", "ping", "pong", "error"] },
    source: { type: "string", enum: ["esp32", "ui", "server"] },
    ts: { type: "number" },
    data: { type: "object" }
  },
  additionalProperties: false
};

const helloSchema = {
  type: "object",
  required: ["role"],
  properties: {
    role: { type: "string", enum: ["esp32", "dashboard"] },
    deviceId: { type: "string" }
  },
  additionalProperties: false
};

const telemetrySchema = {
  type: "object",
  required: ["speedLeft", "speedRight", "gyro", "accel"],
  properties: {
    speedLeft: { type: "integer", minimum: 0, maximum: 255 },
    speedRight: { type: "integer", minimum: 0, maximum: 255 },
    distance: { type: "number" },
    gyro: {
      type: "object",
      required: ["x", "y", "z"],
      properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
      additionalProperties: false
    },
    accel: {
      type: "object",
      required: ["x", "y", "z"],
      properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

const motorControlSchema = {
  type: "object",
  required: ["direction", "speedLeft", "speedRight"],
  properties: {
    direction: { type: "string", enum: ["forward", "reverse", "left", "right", "stop"] },
    speedLeft: { type: "integer", minimum: 0, maximum: 255 },
    speedRight: { type: "integer", minimum: 0, maximum: 255 }
  },
  additionalProperties: false
};

const potholeSchema = {
  type: "object",
  required: ["severity", "value"],
  properties: {
    severity: { type: "string", enum: ["low", "medium", "high"] },
    value: { type: "number" }
  },
  additionalProperties: false
};

const validate = {
  envelope: ajv.compile(envelopeSchema),
  hello: ajv.compile(helloSchema),
  telemetry: ajv.compile(telemetrySchema),
  motorControl: ajv.compile(motorControlSchema),
  pothole: ajv.compile(potholeSchema)
};

function broadcastDash(obj) {
  const payload = json(obj);
  for (const c of groups.dashboard) {
    if (c.readyState === WebSocket.OPEN) c.send(payload);
  }
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(json(obj));
}

function statusUpdate() {
  broadcastDash({
    type: "status",
    source: "server",
    ts: Date.now(),
    data: { esp32Connected: groups.esp32.size > 0, reactClients: groups.dashboard.size }
  });
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WS server running\n");
});

const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (ws) => {
  ws.role = "unknown";
  ws.isAlive = true;

  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) {
      return send(ws, { type: "error", source: "server", ts: Date.now(), data: { reason: "invalid_json" } });
    }

    if (!validate.envelope(msg)) {
      return send(ws, { type: "error", source: "server", ts: Date.now(), data: { reason: "invalid_envelope" } });
    }

    const { type, data } = msg;

    if (type === "hello") {
      if (!validate.hello(data)) return send(ws, { type: "error", source: "server", ts: Date.now(), data: { reason: "invalid_hello" } });
      if (data.role === "esp32") { ws.role = "esp32"; groups.esp32.add(ws); }
      if (data.role === "dashboard") { ws.role = "dashboard"; groups.dashboard.add(ws); }
      statusUpdate();
      return;
    }

    if (type === "ping") { return send(ws, { type: "pong", source: "server", ts: Date.now(), data: {} }); }

    if (type === "telemetry" && ws.role === "esp32") {
      if (!validate.telemetry(data)) return;
      return broadcastDash({ type: "telemetry", source: "server", ts: Date.now(), data });
    }

    if (type === "motorControl" && ws.role === "dashboard") {
      if (!validate.motorControl(data)) {
        return send(ws, { type: "error", source: "server", ts: Date.now(), data: { reason: "invalid_motorControl" } });
      }
      const target = groups.esp32.values().next().value;
      if (!target) {
        send(ws, { type: "error", source: "server", ts: Date.now(), data: { reason: "esp32_disconnected" } });
        statusUpdate();
        return;
      }
      return send(target, { type: "motorControl", source: "server", ts: Date.now(), data });
    }

    if (type === "pothole" && ws.role === "esp32") {
      if (!validate.pothole(data)) return;
      return broadcastDash({ type: "pothole", source: "server", ts: Date.now(), data });
    }
  });

  ws.on("close", () => {
    groups.esp32.delete(ws);
    groups.dashboard.delete(ws);
    statusUpdate();
  });
});

// Heartbeat
const interval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) {}
    try { ws.send(json({ type: "ping", source: "server", ts: Date.now(), data: {} })); } catch (e) {}
  }
}, 15000);

wss.on("close", () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`WS listening on :${PORT}/ws`);
});

