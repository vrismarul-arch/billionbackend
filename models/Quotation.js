// models/Quotation.js
const mongoose = require("mongoose");

const specificationSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    value: { type: String, default: "" },
  },
  { _id: false }
);

const quotationItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Service", default: null },
    serviceName: { type: String, default: "" },
    planId: { type: mongoose.Schema.Types.ObjectId, default: null },
    planName: { type: String, default: "" },
    billingCycle: { type: String, default: null },
    description: { type: String, default: "" },
    hsnSac: { type: String, default: "" },
    quantity: { type: Number, default: 1, min: 0 },
    quantityType: { type: String, default: "" },
    rate: { type: Number, default: 0, min: 0 },
    // NO default 18 — GST only applied when explicitly set
    gstRate: { type: Number, default: 0, min: 0 },
    specifications: { type: [specificationSchema], default: [] },
  },
  { _id: false }
);

const noteSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" },
    author: { type: String, default: "" },
    timestamp: { type: String, default: "" },
  },
  { _id: false }
);

const followUpSchema = new mongoose.Schema(
  {
    date: { type: String, default: "" },
    note: { type: String, default: "" },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: {
      type: String,
      enum: ["pending", "done", "cancelled"],
      default: "pending",
    },
  },
  { timestamps: true }
);

const quotationSchema = new mongoose.Schema(
  {
    quotationNumber: { type: String, unique: true, index: true },

    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessAccount",
      required: true,
    },
    businessName: { type: String, default: "" },
    businessType: { type: String, default: "" },
    businessInfo: { type: String, default: "" },

    gstin: { type: String, default: "" },
    gstType: {
      type: String,
      enum: ["", "intrastate", "interstate"],
      default: "",
    },

    customerName: { type: String, default: "" },
    customerEmail: { type: String, default: "" },
    customerAddress: { type: String, default: "" },
    mobileNumber: { type: String, default: "" },

    status: {
      type: String,
      enum: ["Waiting", "Approved", "Declined"],
      default: "Waiting",
    },

    date: { type: String, default: "" },
    validUntil: { type: String, default: "" },
    createdDate: { type: String, default: "" },

    items: { type: [quotationItemSchema], default: [] },

    subTotal: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },

    notes: { type: [noteSchema], default: [] },
    followUps: { type: [followUpSchema], default: [] },

    pdfUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Quotation", quotationSchema);