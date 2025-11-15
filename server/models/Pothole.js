const mongoose = require("mongoose");

const potholeSchema = new mongoose.Schema({
  routeId: { type: mongoose.Schema.Types.ObjectId, ref: "Route" },
  posX: { type: Number },
  posY: { type: Number },
  severity: { type: String },
  value: { type: Number },
  ts: { type: Number, required: true }
});

module.exports = mongoose.model("Pothole", potholeSchema);
