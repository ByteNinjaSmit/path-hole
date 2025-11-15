"use strict";

const http = require("http");
const WebSocket = require("ws");
const Ajv = require("ajv");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config();

const Route = require("./models/Route");
const Telemetry = require("./models/Telemetry");
const Pothole = require("./models/Pothole");

const PORT = process.env.PORT || 8080;

const groups = { esp32: new Set(), dashboard: new Set() };

function json(obj) { return JSON.stringify(obj); }

// Ajv validators
const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });
const envelopeSchema = {
  type: "object",
  required: ["type", "source", "ts", "data"],
  properties: {
    type: { type: "string", enum: ["hello", "telemetry", "motorControl", "status", "pothole", "ping", "pong", "error", "pathCommand", "autoDrive", "routeComplete"] },
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
    heading: { type: "number" },
    posX: { type: "number" },
    posY: { type: "number" },
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
    value: { type: "number" },
    posX: { type: "number" },
    posY: { type: "number" }
  },
  additionalProperties: false
};

const pathPointSchema = {
  type: "object",
  required: ["x", "y"],
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    heading: { type: "number" }
  },
  additionalProperties: false
};

const pathCommandSchema = {
  type: "object",
  required: ["path"],
  properties: {
    path: {
      type: "array",
      items: pathPointSchema,
      minItems: 1
    }
  },
  additionalProperties: false
};

const autoDriveSchema = {
  type: "object",
  required: ["speed", "path"],
  properties: {
    routeId: { type: "string" },
    speed: { type: "integer", minimum: 0, maximum: 255 },
    path: {
      type: "array",
      items: pathPointSchema,
      minItems: 1
    }
  },
  additionalProperties: false
};

const validate = {
  envelope: ajv.compile(envelopeSchema),
  hello: ajv.compile(helloSchema),
  telemetry: ajv.compile(telemetrySchema),
  motorControl: ajv.compile(motorControlSchema),
  pothole: ajv.compile(potholeSchema),
  pathCommand: ajv.compile(pathCommandSchema),
  autoDrive: ajv.compile(autoDriveSchema)
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

mongoose
  .connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/pathhole")
  .then(() => {
    console.log("MongoDB connected");
  })
  .catch((err) => {
    console.error("MongoDB connection error", err);
  });

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/routes", async (req, res) => {
  try {
    const routes = await Route.find({}, "name description createdAt").sort({ createdAt: -1 });
    res.json(routes);
  } catch (e) {
    res.status(500).json({ error: "failed_to_list_routes" });
  }
});

app.post("/api/routes", async (req, res) => {
  try {
    const { name, description, path } = req.body || {};
    if (!name || !Array.isArray(path) || path.length === 0) {
      return res.status(400).json({ error: "invalid_route" });
    }
    const route = await Route.create({ name, description, path });
    res.status(201).json(route);
  } catch (e) {
    res.status(500).json({ error: "failed_to_create_route" });
  }
});

app.get("/api/routes/:id", async (req, res) => {
  try {
    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ error: "route_not_found" });
    res.json(route);
  } catch (e) {
    res.status(500).json({ error: "failed_to_get_route" });
  }
});

app.get("/api/routes/:id/stats", async (req, res) => {
  try {
    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ error: "route_not_found" });

    let distanceMeters = 0;
    const path = Array.isArray(route.path) ? route.path : [];
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const dx = (b.x || 0) - (a.x || 0);
      const dy = (b.y || 0) - (a.y || 0);
      distanceMeters += Math.sqrt(dx * dx + dy * dy);
    }

    const potholeAgg = await Pothole.aggregate([
      { $match: { routeId: route._id } },
      { $group: { _id: "$severity", count: { $sum: 1 } } }
    ]);

    const potholesBySeverity = { low: 0, medium: 0, high: 0, unknown: 0 };
    let potholesTotal = 0;
    for (const row of potholeAgg) {
      const key = row._id || "unknown";
      potholesTotal += row.count;
      if (key === "low" || key === "medium" || key === "high") {
        potholesBySeverity[key] = row.count;
      } else {
        potholesBySeverity.unknown += row.count;
      }
    }

    res.json({
      distanceMeters,
      potholesTotal,
      potholesBySeverity
    });
  } catch (e) {
    res.status(500).json({ error: "failed_to_get_route_stats" });
  }
});

app.get("/api/routes/:id/potholes", async (req, res) => {
  try {
    const route = await Route.findById(req.params.id);
    if (!route) return res.status(404).json({ error: "route_not_found" });
    const items = await Pothole.find({ routeId: route._id }, "posX posY severity value ts").sort({ ts: 1 });
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: "failed_to_get_route_potholes" });
  }
});

app.put("/api/routes/:id", async (req, res) => {
  try {
    const { name, description } = req.body || {};
    const update = {};
    if (typeof name === "string" && name.trim()) update.name = name.trim();
    if (typeof description === "string") update.description = description;
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "nothing_to_update" });
    }
    const route = await Route.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!route) return res.status(404).json({ error: "route_not_found" });
    res.json(route);
  } catch (e) {
    res.status(500).json({ error: "failed_to_update_route" });
  }
});

app.delete("/api/routes/:id", async (req, res) => {
  try {
    const deleted = await Route.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: "route_not_found" });
    res.status(204).end();
  } catch (e) {
    res.status(500).json({ error: "failed_to_delete_route" });
  }
});

const server = http.createServer(app);

const wss = new WebSocket.Server({ server, path: "/ws" });

let lastTelemetryCheckpointTs = 0;
let currentRouteId = null;

wss.on("connection", (ws) => {
  ws.role = "unknown";
  ws.isAlive = true;

  ws.on("pong", () => { ws.isAlive = true; });

  ws.on("message", async (raw) => {
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
      const ts = Date.now();
      broadcastDash({ type: "telemetry", source: "server", ts, data });
      if (ts - lastTelemetryCheckpointTs > 2000) {
        lastTelemetryCheckpointTs = ts;
        try {
          await Telemetry.create({
            routeId: currentRouteId,
            posX: data.posX,
            posY: data.posY,
            heading: data.heading,
            speedLeft: data.speedLeft,
            speedRight: data.speedRight,
            ts
          });
        } catch (e) {}
      }
      return;
    }

    if (type === "routeComplete" && ws.role === "esp32") {
      const ts = Date.now();
      broadcastDash({
        type: "routeComplete",
        source: "server",
        ts,
        data: { routeId: currentRouteId }
      });
      currentRouteId = null;
      return;
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
      currentRouteId = null;
      return send(target, { type: "motorControl", source: "server", ts: Date.now(), data });
    }

    if (type === "pothole" && ws.role === "esp32") {
      if (!validate.pothole(data)) return;
      const ts = Date.now();
      broadcastDash({ type: "pothole", source: "server", ts, data });
      try {
        await Pothole.create({
          routeId: currentRouteId,
          posX: data.posX,
          posY: data.posY,
          severity: data.severity,
          value: data.value,
          ts
        });
      } catch (e) {}
      return;
    }

    if (type === "pathCommand" && ws.role === "dashboard") {
      if (!validate.pathCommand(data)) {
        return send(ws, { type: "error", source: "server", ts: Date.now(), data: { reason: "invalid_pathCommand" } });
      }
      const target = groups.esp32.values().next().value;
      if (!target) {
        send(ws, { type: "error", source: "server", ts: Date.now(), data: { reason: "esp32_disconnected" } });
        statusUpdate();
        return;
      }
      currentRouteId = data.routeId || null;
      return send(target, { type: "pathCommand", source: "server", ts: Date.now(), data });
    }

    if (type === "autoDrive" && ws.role === "dashboard") {
      if (!validate.autoDrive(data)) {
        return send(ws, { type: "error", source: "server", ts: Date.now(), data: { reason: "invalid_autoDrive" } });
      }
      const target = groups.esp32.values().next().value;
      if (!target) {
        send(ws, { type: "error", source: "server", ts: Date.now(), data: { reason: "esp32_disconnected" } });
        statusUpdate();
        return;
      }
      currentRouteId = data.routeId || null;
      return send(target, { type: "autoDrive", source: "server", ts: Date.now(), data });
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

