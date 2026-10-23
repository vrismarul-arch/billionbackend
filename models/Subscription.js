
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

    currentPlan: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    planName: {
      type: String,
      required: true,
    },

    planPriceMonthly: Number,
    planPriceYearly: Number,
    planPriceOneTime: Number,

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

    // Invoice details
    invoiceNo: {
      type: String,
      default: null,
    },

    invoiceSentAt: {
      type: Date,
      default: null,
    },

    invoiceSentTo: {
      type: String,
      default: null,
    },

    // Razorpay payment-link details
    paymentLinkId: {
      type: String,
      default: null,
    },

    paymentLinkUrl: {
      type: String,
      default: null,
    },

    // Invoice payment status
    invoicePaymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },

    paidAt: {
      type: Date,
      default: null,
    },

    history: [subscriptionHistorySchema],
  },
  { timestamps: true }
);

// Prevent duplicate invoice numbers.
// Multiple subscriptions without an invoice number are allowed.
subscriptionSchema.index(
  { invoiceNo: 1 },
  {
    unique: true,
    partialFilterExpression: {
      invoiceNo: { $type: "string" },
    },
  }
);

module.exports = mongoose.model("Subscription", subscriptionSchema);
