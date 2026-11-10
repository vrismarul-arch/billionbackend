// File: models/Subscription.js
const mongoose = require("mongoose");

const subscriptionHistorySchema = new mongoose.Schema(
  {
    previousPlanName: String,
    newPlanName: String,
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    changedDate: {
      type: Date,
      default: Date.now,
    },
    note: String,
  },
  { _id: false }
);

/* Schema for individual service items */
const subscriptionItemSchema = new mongoose.Schema(
  {
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BrandService",
      required: true,
    },
    serviceName: String,
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    planName: String,
    billingCycle: {
      type: String,
      enum: ["Monthly", "Yearly", "One Time"],
      default: "Monthly",
    },
    quantity: {
      type: Number,
      default: 1,
    },
    amountPaid: Number,
    gstRate: Number,
    totalWithGST: Number,
  },
  { _id: true }
);

const subscriptionSchema = new mongoose.Schema(
  {
    businessAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessAccount",
      required: true,
    },

    items: [subscriptionItemSchema],

    // backward-compat single-service fields
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BrandService",
      required: false,
    },
    currentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    planName: {
      type: String,
      required: false,
    },
    planPriceMonthly: Number,
    planPriceYearly: Number,
    planPriceOneTime: Number,
    billingCycle: {
      type: String,
      enum: ["Monthly", "Yearly", "One Time"],
      default: "Monthly",
    },

    // TOTALS
    amountPaid: Number,
    gstRate: Number,
    totalWithGST: Number,

    orderId: String,
    paymentId: String,

    purchaseDate: {
      type: Date,
      default: Date.now,
    },

    renewalDate: Date,

    status: {
      type: String,
      enum: ["active", "expired", "cancelled", "pending", "lifetime"],
      default: "active",
    },

    autoRenew: {
      type: Boolean,
      default: true,
    },

    invoiceNo: { type: String, default: null },
    invoiceSentAt: { type: Date, default: null },
    invoiceSentTo: { type: String, default: null },
    paymentLinkId: { type: String, default: null },
    paymentLinkUrl: { type: String, default: null },
    invoicePaymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    paidAt: { type: Date, default: null },

    history: [subscriptionHistorySchema],
  },
  { timestamps: true }
);

subscriptionSchema.index(
  { invoiceNo: 1 },
  {
    unique: true,
    partialFilterExpression: { invoiceNo: { $type: "string" } },
  }
);

module.exports = mongoose.model("Subscription", subscriptionSchema);