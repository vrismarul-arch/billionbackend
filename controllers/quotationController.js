// controllers/quotationController.js
const mongoose = require("mongoose");
const Quotation = require("../models/Quotation");
const Business = require("../models/BusinessAccount");

// ============================================
// HELPERS
// ============================================

const isValidId = (id) => mongoose.isValidObjectId(id);

const roundAmount = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

// Calculate totals from quotation items.
// GST is ONLY applied when a GST type is provided.
const calculateTotals = (items = [], gstType) => {
  let subTotal = 0;
  let tax = 0;

  const hasGstType = gstType === "intrastate" || gstType === "interstate";

  for (const item of items) {
    const quantity = Number(item.quantity ?? 1);
    const rate = Number(item.rate ?? 0);
    const gstRate = Number(item.gstRate ?? 0); // no default 18

    if (
      !Number.isFinite(quantity) ||
      !Number.isFinite(rate) ||
      !Number.isFinite(gstRate) ||
      quantity < 0 ||
      rate < 0 ||
      gstRate < 0
    ) {
      throw new Error("Invalid quantity, price or GST rate.");
    }

    const amount = quantity * rate;
    subTotal += amount;

    if (hasGstType && gstRate > 0) {
      tax += (amount * gstRate) / 100;
    }
  }

  subTotal = roundAmount(subTotal);
  tax = roundAmount(tax);

  return {
    subTotal,
    tax,
    total: roundAmount(subTotal + tax),
  };
};

// Fields allowed to be saved.
const allowedFields = [
  "businessId",
  "businessName",
  "businessType",
  "businessInfo",
  "gstin",
  "customerName",
  "customerEmail",
  "customerAddress",
  "mobileNumber",
  "status",
  "date",
  "validUntil",
  "items",
  "notes",
  "createdDate",
  "pdfUrl",
  "gstType",
  "subTotal",
  "tax",
  "total",
];

// ============================================
// BUILD PAYLOAD
// ============================================

const buildPayload = (body) => {
  const payload = {};

  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = body[field];
    }
  }

  // QUOTATION ITEMS
  if (payload.items !== undefined) {
    if (!Array.isArray(payload.items)) {
      throw new Error("Quotation items must be an array.");
    }

    payload.items = payload.items.map((item) => {
      const quantity = Number(item.quantity ?? 1);
      const rate = Number(item.rate ?? 0);
      const gstRate = Number(item.gstRate ?? 0); // no default 18

      if (
        !Number.isFinite(quantity) ||
        !Number.isFinite(rate) ||
        !Number.isFinite(gstRate) ||
        quantity < 0 ||
        rate < 0 ||
        gstRate < 0
      ) {
        throw new Error("Invalid quantity, price or GST rate.");
      }

      return {
        productId: item.productId?._id || item.productId || null,
        serviceName: item.serviceName || "",
        planId: item.planId?._id || item.planId || null,
        planName: item.planName || "",
        billingCycle: item.billingCycle || null,
        description: item.description || "",
        hsnSac: item.hsnSac || "",
        quantity,
        quantityType: item.quantityType || "",
        rate,
        gstRate,
        specifications: Array.isArray(item.specifications)
          ? item.specifications.map((spec) => ({
              name: spec.name || "",
              value: spec.value || "",
            }))
          : [],
      };
    });
  }

  // MANUAL TOTAL AMOUNTS
  for (const field of ["subTotal", "tax", "total"]) {
    if (payload[field] !== undefined) {
      const amount = Number(payload[field]);

      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(`Invalid ${field} amount.`);
      }

      payload[field] = roundAmount(amount);
    }
  }

  // AUTO CALCULATE ONLY WHEN NOT PROVIDED
  if (payload.items !== undefined) {
    const calculated = calculateTotals(payload.items, payload.gstType);

    if (payload.subTotal === undefined) payload.subTotal = calculated.subTotal;
    if (payload.tax === undefined) payload.tax = calculated.tax;
    if (payload.total === undefined) payload.total = calculated.total;
  }

  return payload;
};

// ============================================
// GET ALL QUOTATIONS
// ============================================

exports.getAll = async (req, res) => {
  try {
    const quotations = await Quotation.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json(quotations);
  } catch (error) {
    console.error("Get quotations error:", error);
    return res.status(500).json({
      message: "Failed to fetch quotations.",
      error: error.message,
    });
  }
};

// ============================================
// GET SINGLE QUOTATION
// ============================================

exports.getById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid quotation ID." });
    }

    const quotation = await Quotation.findById(id).lean();

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found." });
    }

    return res.status(200).json(quotation);
  } catch (error) {
    console.error("Get quotation error:", error);
    return res.status(500).json({
      message: "Failed to fetch quotation.",
      error: error.message,
    });
  }
};

// ============================================
// GENERATE UNIQUE QUOTATION NUMBER
// ============================================

const generateQuotationNumber = async () => {
  const lastQuotation = await Quotation.findOne({
    quotationNumber: /^Q-\d+$/,
  })
    .sort({ createdAt: -1 })
    .select("quotationNumber")
    .lean();

  let nextNumber = 1;

  if (lastQuotation?.quotationNumber) {
    const lastNumber = Number(lastQuotation.quotationNumber.replace("Q-", ""));
    if (Number.isFinite(lastNumber)) {
      nextNumber = lastNumber + 1;
    }
  }

  return `Q-${String(nextNumber).padStart(4, "0")}`;
};

// ============================================
// CREATE QUOTATION
// ============================================

exports.create = async (req, res) => {
  try {
    const payload = buildPayload(req.body);

    if (!payload.businessId || !isValidId(payload.businessId)) {
      return res.status(400).json({ message: "Valid business ID is required." });
    }

    if (!payload.items || payload.items.length === 0) {
      return res.status(400).json({
        message: "At least one quotation item is required.",
      });
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const quotationNumber = await generateQuotationNumber();

        const quotation = new Quotation({
          ...payload,
          quotationNumber,
          status: "Waiting",
          createdDate:
            payload.createdDate || new Date().toLocaleDateString("en-IN"),
        });

        const saved = await quotation.save();
        return res.status(201).json(saved);
      } catch (error) {
        if (error.code === 11000 && attempt < 4) continue;
        throw error;
      }
    }
  } catch (error) {
    console.error("Create quotation error:", error);
    return res.status(400).json({
      message: "Failed to create quotation.",
      error: error.message,
    });
  }
};

// ============================================
// UPDATE QUOTATION
// ============================================

exports.update = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid quotation ID." });
    }

    const quotation = await Quotation.findById(id);

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found." });
    }

    const payload = buildPayload(req.body);

    // If gstType wasn't sent, use the stored one so totals stay correct
    if (payload.gstType === undefined) {
      payload.gstType = quotation.gstType || "";
    }

    // If items were sent but gstType wasn't, recompute with the stored gstType
    if (payload.items !== undefined && req.body.gstType === undefined) {
      const calculated = calculateTotals(payload.items, payload.gstType);
      if (req.body.subTotal === undefined) payload.subTotal = calculated.subTotal;
      if (req.body.tax === undefined) payload.tax = calculated.tax;
      if (req.body.total === undefined) payload.total = calculated.total;
    }

    if (payload.items !== undefined && payload.items.length === 0) {
      return res.status(400).json({
        message: "At least one quotation item is required.",
      });
    }

    if (payload.businessId !== undefined && !isValidId(payload.businessId)) {
      return res.status(400).json({ message: "Invalid business ID." });
    }

    Object.assign(quotation, payload);

    const updated = await quotation.save();

    return res.status(200).json({
      message: "Quotation updated successfully.",
      quotation: updated,
    });
  } catch (error) {
    console.error("Update quotation error:", error);
    return res.status(400).json({
      message: "Failed to update quotation.",
      error: error.message,
    });
  }
};

// ============================================
// DELETE QUOTATION
// ============================================

exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid quotation ID." });
    }

    const deleted = await Quotation.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ message: "Quotation not found." });
    }

    return res.status(200).json({
      message: "Quotation deleted successfully.",
    });
  } catch (error) {
    console.error("Delete quotation error:", error);
    return res.status(500).json({
      message: "Failed to delete quotation.",
      error: error.message,
    });
  }
};

// ============================================
// GET ACTIVE BUSINESSES
// ============================================

exports.getActiveBusinesses = async (req, res) => {
  try {
    const businesses = await Business.find({ status: "Customer" })
      .sort({ businessName: 1 })
      .lean();

    return res.status(200).json(businesses);
  } catch (error) {
    console.error("Get businesses error:", error);
    return res.status(500).json({
      message: "Failed to fetch active businesses.",
      error: error.message,
    });
  }
};

// ============================================
// GET QUOTATIONS BY BUSINESS ID
// ============================================

exports.getQuotationsByBusinessId = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid business ID." });
    }

    const quotations = await Quotation.find({ businessId: id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(quotations);
  } catch (error) {
    console.error("Business quotations error:", error);
    return res.status(500).json({
      message: "Failed to fetch business quotations.",
      error: error.message,
    });
  }
};

// ============================================
// GET FOLLOW-UPS BY QUOTATION ID
// ============================================

exports.getFollowUpsByQuotationId = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid quotation ID." });
    }

    const quotation = await Quotation.findById(id).populate(
      "followUps.addedBy",
      "name email"
    );

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found." });
    }

    return res.status(200).json(quotation.followUps || []);
  } catch (error) {
    console.error("Get follow-ups error:", error);
    return res.status(500).json({
      message: "Failed to fetch follow-ups.",
      error: error.message,
    });
  }
};

// ============================================
// ADD FOLLOW-UP
// ============================================

exports.addFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, note, addedBy, status } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid quotation ID." });
    }

    if (!date || !note?.trim()) {
      return res.status(400).json({
        message: "Date and note are required.",
      });
    }

    const quotation = await Quotation.findById(id);

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found." });
    }

    quotation.followUps.push({
      date,
      note: note.trim(),
      addedBy: addedBy || undefined,
      status: status || "pending",
    });

    await quotation.save();
    await quotation.populate("followUps.addedBy", "name email");

    return res.status(200).json({
      message: "Follow-up added successfully.",
      followUps: quotation.followUps,
    });
  } catch (error) {
    console.error("Add follow-up error:", error);
    return res.status(400).json({
      message: "Failed to add follow-up.",
      error: error.message,
    });
  }
};

// ============================================
// UPDATE FOLLOW-UP
// ============================================

exports.updateFollowUp = async (req, res) => {
  try {
    const { id, index } = req.params;
    const { date, note, status } = req.body;

    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid quotation ID." });
    }

    const quotation = await Quotation.findById(id);

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found." });
    }

    const followUpIndex = Number(index);

    if (
      !Number.isInteger(followUpIndex) ||
      followUpIndex < 0 ||
      followUpIndex >= quotation.followUps.length
    ) {
      return res.status(404).json({ message: "Follow-up not found." });
    }

    const followUp = quotation.followUps[followUpIndex];

    if (date !== undefined) followUp.date = date;
    if (note !== undefined) followUp.note = note;
    if (status !== undefined) followUp.status = status;

    await quotation.save();
    await quotation.populate("followUps.addedBy", "name email");

    return res.status(200).json({
      message: "Follow-up updated successfully.",
      followUps: quotation.followUps,
    });
  } catch (error) {
    console.error("Update follow-up error:", error);
    return res.status(400).json({
      message: "Failed to update follow-up.",
      error: error.message,
    });
  }
};

// ============================================
// DELETE FOLLOW-UP
// ============================================

exports.deleteFollowUp = async (req, res) => {
  try {
    const { id, index } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid quotation ID." });
    }

    const quotation = await Quotation.findById(id);

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found." });
    }

    const followUpIndex = Number(index);

    if (
      !Number.isInteger(followUpIndex) ||
      followUpIndex < 0 ||
      followUpIndex >= quotation.followUps.length
    ) {
      return res.status(404).json({ message: "Follow-up not found." });
    }

    quotation.followUps.splice(followUpIndex, 1);

    await quotation.save();
    await quotation.populate("followUps.addedBy", "name email");

    return res.status(200).json({
      message: "Follow-up deleted successfully.",
      followUps: quotation.followUps,
    });
  } catch (error) {
    console.error("Delete follow-up error:", error);
    return res.status(500).json({
      message: "Failed to delete follow-up.",
      error: error.message,
    });
  }
};