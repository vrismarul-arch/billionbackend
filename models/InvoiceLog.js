const mongoose = require("mongoose");

const invoiceLogSchema = new mongoose.Schema(
  {
    subscription: { type: mongoose.Schema.Types.ObjectId, ref: "Subscription", required: true, index: true },
    businessAccount: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount" },
    invoiceNo: String,
    action: {
      type: String,
      enum: ["generated", "payment_link_created", "sent", "paid", "link_expired", "link_cancelled"],
      required: true,
    },
    amount: Number,
    sentTo: String,
    paymentLinkUrl: String,
    note: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("InvoiceLog", invoiceLogSchema);