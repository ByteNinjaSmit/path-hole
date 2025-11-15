const mongoose = require("mongoose");

const routeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  path: [
    {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
      heading: { type: Number }
    }
  ],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Route", routeSchema);
