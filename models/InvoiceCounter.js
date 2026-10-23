
const mongoose = require("mongoose");

const invoiceCounterSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      required: true,
    },
    sequence: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    versionKey: false,
  }
);

module.exports = mongoose.model(
  "InvoiceCounter",
  invoiceCounterSchema
);
