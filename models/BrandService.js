const mongoose = require("mongoose");

// Notes
const noteSchema = new mongoose.Schema(
  {
    text: String,
    timestamp: String,
    author: String,
  },
  { _id: false }
);

// Features inside Plan
const planFeatureSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
  },
  { _id: false }
);

// Plan Schema (Monthly/Yearly)
const planSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // Basic, Premium etc.
    priceMonthly: { type: Number, default: 0 },
    priceYearly: { type: Number, default: 0 },
    priceOneTime: { type: Number, default: 0 },
    scriptBased: { type: Boolean, default: false },
    features: [planFeatureSchema],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Main Brand Service Schema
const brandServiceSchema = new mongoose.Schema(
  {
    service_id: { type: String, required: true, unique: true },
    serviceName: { type: String, required: true },
    category: String,
    description: String,
    basePrice: Number,
    options: [],
    notes: [noteSchema],
    plans: [planSchema],
    isActive: { type: Boolean, default: true },
    gstRate: { type: Number, default: 18 },
    order: { type: Number, default: 0, index: true }, // drag & drop position
  },
  { timestamps: true }
);

module.exports = mongoose.model("BrandService", brandServiceSchema);