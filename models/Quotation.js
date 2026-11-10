// Quotation.js
const mongoose = require('mongoose');

const specificationSchema = new mongoose.Schema({
  name: String,
  value: String
}, { _id: false });

const itemSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  description: String,
  hsnSac: String,
  quantity: Number,
  quantityType: String,
  rate: Number,
  specifications: [specificationSchema]
}, { _id: false });

const noteSchema = new mongoose.Schema({
  text: String,
  timestamp: String,
  author: String
}, { _id: false });

// Follow-ups: 'addedBy' references 'User'
const followUpSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  note: { type: String, required: true },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: {
    type: String,
    enum: ['pending', 'completed'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

const quotationSchema = new mongoose.Schema({
  businessId: { type: mongoose.Schema.Types.ObjectId, ref: 'BusinessAccount', required: true },
  businessName: String,
  businessType: String,
  businessInfo: String,
  gstin: String,
  followUps: [followUpSchema],

  // Quotation status: Waiting -> Approved / Declined
  status: {
    type: String,
    enum: ['Waiting', 'Approved', 'Declined'],
    default: 'Waiting'
  },

  quotationNumber: { type: String, unique: true, required: true },
  date: String,
  validUntil: String,
  customerName: String,
  customerAddress: String,
  items: [itemSchema],
  subTotal: Number,
  tax: Number,
  total: Number,
  createdDate: String,
  notes: [noteSchema],
  pdfUrl: String,
  gstType: String
}, { timestamps: true });

module.exports = mongoose.model('Quotation', quotationSchema);