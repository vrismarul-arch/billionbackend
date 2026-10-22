// File: models/Subscription.js

const mongoose = require("mongoose");

const subscriptionHistorySchema = new mongoose.Schema(
  {
    previousPlanName: String,
    newPlanName: String,
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    changedDate: { type: Date, default: Date.now },
    note: String,
  },
  { _id: false }
);

const subscriptionSchema = new mongoose.Schema(
  {
    businessAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessAccount",
      required: true,
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BrandService",
      required: true,
    },

    // ✅ NEW: store the plan subdoc id so we can round-trip it
    currentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // Snapshot fields (kept so historical/plan changes remain visible)
    planName: { type: String, required: true },
    planPriceMonthly: Number,
    planPriceYearly: Number,
    planPriceOneTime: Number, // ✅ add this (used by One Time plans)

    billingCycle: {
      type: String,
      enum: ["Monthly", "Yearly", "One Time"],
      default: "Monthly",
    },

    amountPaid: Number,
    gstRate: Number,
    totalWithGST: Number,
    orderId: String,
    paymentId: String,
    purchaseDate: { type: Date, default: Date.now },
    renewalDate: Date,

    status: {
      type: String,
      enum: ["active", "expired", "cancelled", "pending", "lifetime"],
      default: "active",
    },
    autoRenew: { type: Boolean, default: true },

    history: [subscriptionHistorySchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Subscription", subscriptionSchema);