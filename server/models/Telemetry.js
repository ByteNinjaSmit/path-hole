const mongoose = require("mongoose");

const telemetrySchema = new mongoose.Schema({
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: "Route" },
  posX: { type: Number },
  posY: { type: Number },
  heading: { type: Number },
  speedLeft: { type: Number },
  speedRight: { type: Number },
  ts: { type: Number, required: true }
});

module.exports = mongoose.model("Telemetry", telemetrySchema);
