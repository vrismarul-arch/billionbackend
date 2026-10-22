// controllers/businessAccountController.js

const BusinessAccount = require("../models/BusinessAccount");
const BrandService = require("../models/BrandService");
const Quotation = require("../models/Quotation"); // in case you use later
const User = require("../models/User");
const mongoose = require("mongoose");

// Common populate options
const populateOptions = [
  { path: "assignedTo", select: "name role" },
  { path: "followUps.addedBy", select: "name" },
  // ✅ NEW: multiple services
  {
    path: "services.service",
    select: "serviceName basePrice gstRate plans",
    model: "BrandService",
  },
  // ⚠️ LEGACY single service (kept for old screens)
  {
    path: "selectedService",
    select: "serviceName basePrice gstRate plans",
    model: "BrandService",
  },
];

// ✅ Small helper to normalize GST with default 18%
const getEffectiveGstRate = (gstValue) => {
  const num = Number(gstValue);
  // if num is NaN, 0, null, undefined → fallback 18
  if (!num || num < 0) return 18;
  return num;
};

const escapeRegex = (str = "") => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toId = (value) => value?._id || value || null;

// Helper to calculate price with GST based on service + plan + billingCycle
const calculateTotalPrice = (service, planId, billingCycle = "Monthly") => {
  if (!service) return 0;

  let base = 0;

  // Try to use a plan if given
  if (planId && mongoose.Types.ObjectId.isValid(planId) && service.plans?.length > 0) {
    const plan = service.plans.id(planId);
    if (plan) {
      if (billingCycle === "Monthly") base = plan.priceMonthly || 0;
      else if (billingCycle === "Yearly") base = plan.priceYearly || 0;
      else if (billingCycle === "One Time") base = plan.priceOneTime || 0;
    }
  }

  // Fallback to basePrice of service if no plan price found
  if (!base && typeof service.basePrice === "number") {
    base = service.basePrice;
  }

  const gstRate = getEffectiveGstRate(service.gstRate);
  const gstAmount = (base * gstRate) / 100;

  return Math.round(base + gstAmount);
};

// =========================
// MULTI-SERVICE HELPERS
// =========================

// Read the raw services list from a request body.
// - new clients send  services: [...]
// - old clients send  selectedService / selectedPlan / billingCycle
// Returns null when the request says nothing about services.
const resolveRawServices = (body) => {
  if (Array.isArray(body.services)) return body.services;

  if (body.selectedService) {
    return [
      {
        service: body.selectedService,
        plan: body.selectedPlan,
        billingCycle: body.billingCycle,
      },
    ];
  }

  return null;
};

// Validate rows, load services from DB and calculate every price on the server
// (we never trust the price sent by the browser).
const buildServices = async (rawServices = []) => {
  const rows = rawServices.filter((r) => {
    const id = toId(r?.service);
    return id && mongoose.Types.ObjectId.isValid(id);
  });

  if (rows.length === 0) return { services: [], totalPrice: 0 };

  const ids = rows.map((r) => toId(r.service));
  const found = await BrandService.find({ _id: { $in: ids } });
  const byId = new Map(found.map((s) => [String(s._id), s]));

  let totalPrice = 0;
  const services = [];

  for (const row of rows) {
    const srv = byId.get(String(toId(row.service)));
    if (!srv) continue; // unknown service id → skip

    const planId = toId(row.plan);
    const billingCycle = ["Monthly", "Yearly", "One Time"].includes(row.billingCycle)
      ? row.billingCycle
      : "Monthly";

    const price = calculateTotalPrice(srv, planId, billingCycle);
    totalPrice += price;

    services.push({
      service: srv._id,
      plan: planId && mongoose.Types.ObjectId.isValid(planId) ? planId : null,
      billingCycle,
      gstRate: getEffectiveGstRate(srv.gstRate),
      price,
    });
  }

  return { services, totalPrice };
};

// Writes services + totals (+ legacy single-service fields) onto `target`
const applyServices = async (target, rawServices) => {
  const { services, totalPrice } = await buildServices(rawServices);
  const first = services[0];

  target.services = services;
  target.totalPrice = totalPrice;

  // Keep legacy fields in sync with the first service
  target.selectedService = first ? first.service : null;
  target.selectedPlan = first ? first.plan : null;
  target.billingCycle = first ? first.billingCycle : "Monthly";
  target.gstRate = first ? first.gstRate : 18;
};

// =========================
// GET all accounts
// =========================
exports.getAll = async (req, res) => {
  try {
    const accounts = await BusinessAccount.find().populate(populateOptions);
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =========================
// GET paginated accounts
// =========================
exports.getPaginatedAccounts = async (req, res) => {
  try {
    const {
      page = 1,
      pageSize = 10,
      search = "",
      status,
      sortBy = "createdAt",
      sortOrder = "desc",
      userId,
      role,
      teamLeaderId, // if you later want TL filtering
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    let query = {};

    // Role-based filtering
    if (role === "Employee" && userId) {
      query.assignedTo = userId;
    }

    // (Optional: for Team Leader role, if you have team mapping, implement here)
    // if (role === "Team Leader" && teamLeaderId) { ... }

    if (status && status !== "all") {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { businessName: { $regex: escapeRegex(search), $options: "i" } },
        { contactName: { $regex: escapeRegex(search), $options: "i" } },
      ];
    }

    const total = await BusinessAccount.countDocuments(query);

    const accounts = await BusinessAccount.find(query)
      .populate(populateOptions)
      .sort({ [sortBy]: sortOrder === "asc" ? 1 : -1 })
      .skip(skip)
      .limit(limit);

    res.json({
      data: accounts,
      total,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
  } catch (err) {
    console.error("Error in getPaginatedAccounts:", err);
    res.status(500).json({
      error: err.message || "Server error fetching paginated accounts",
    });
  }
};

// =========================
// GET aggregated status counts
// =========================
exports.getAccountCounts = async (req, res) => {
  try {
    let matchQuery = {};

    // user/role filter
    if (req.query.role === "Employee" && req.query.userId) {
      matchQuery.assignedTo = new mongoose.Types.ObjectId(req.query.userId);
    }

    const counts = await BusinessAccount.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          all: [{ $count: "total" }],
          active: [{ $match: { status: "Active" } }, { $count: "total" }],
          Pipeline: [{ $match: { status: "Pipeline" } }, { $count: "total" }],
          quotations: [{ $match: { status: "Quotations" } }, { $count: "total" }],
          customers: [{ $match: { status: "Customer" } }, { $count: "total" }],
          closed: [{ $match: { status: "Closed" } }, { $count: "total" }],
          targetLeads: [{ $match: { status: "TargetLeads" } }, { $count: "total" }],
        },
      },
      {
        $project: {
          all: { $arrayElemAt: ["$all.total", 0] },
          active: { $arrayElemAt: ["$active.total", 0] },
          Pipeline: { $arrayElemAt: ["$Pipeline.total", 0] },
          quotations: { $arrayElemAt: ["$quotations.total", 0] },
          customers: { $arrayElemAt: ["$customers.total", 0] },
          closed: { $arrayElemAt: ["$closed.total", 0] },
          targetLeads: { $arrayElemAt: ["$targetLeads.total", 0] },
        },
      },
    ]);

    const formattedCounts = {
      all: counts[0]?.all || 0,
      active: counts[0]?.active || 0,
      Pipeline: counts[0]?.Pipeline || 0,
      quotations: counts[0]?.quotations || 0,
      customers: counts[0]?.customers || 0,
      closed: counts[0]?.closed || 0,
      targetLeads: counts[0]?.targetLeads || 0,
    };

    res.status(200).json(formattedCounts);
  } catch (error) {
    console.error("Error fetching account counts:", error);
    res.status(500).json({
      message: "Error fetching account counts",
      error: error.message,
    });
  }
};

// =========================
// GET leads by sourceType
// =========================
exports.getLeadsBySource = async (req, res) => {
  try {
    const { sourceType } = req.params;
    const leads = await BusinessAccount.find({
      status: { $ne: "Customer" },
      sourceType: sourceType,
    }).populate(populateOptions);
    res.json(leads);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching leads by source",
      error: error.message,
    });
  }
};

// =========================
// GET only Active leads
// =========================
exports.getActiveLeads = async (req, res) => {
  try {
    const leads = await BusinessAccount.find({ status: "Active" }).populate(
      populateOptions
    );
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =========================
// GET only Customers
// =========================
exports.getCustomers = async (req, res) => {
  try {
    const customers = await BusinessAccount.find({
      status: "Customer",
    }).populate(populateOptions);
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =========================
// GET account by ID (Fixed + Normalized Response)
// =========================
exports.getAccountById = async (req, res) => {
  try {
    const account = await BusinessAccount.findById(req.params.id).populate(
      populateOptions
    );

    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    const formatted = {
      ...account.toObject(),

      // 🔄 Normalize fields for frontend
      email: account.contactEmail || "N/A",
      phoneNumber: account.contactNumber || "N/A",
      type: account.typeOfLead?.[0] || "N/A",

      followups: account.followUps || [],
      notes: account.notes || [],

      address: {
        line1: account.addressLine1 || "",
        line2: account.addressLine2 || "",
        city: account.city || "",
        state: account.state || "",
        pincode: account.pincode || "",
        country: account.country || "",
      },
    };

    res.json(formatted);
  } catch (err) {
    console.error("getAccountById error:", err);
    res.status(500).json({ error: err.message });
  }
};

// =========================
// CREATE account
// =========================
exports.create = async (req, res) => {
  try {
    const data = { ...req.body };

    // Duplicate businessName (case-insensitive)
    const existingAccount = await BusinessAccount.findOne({
      businessName: {
        $regex: new RegExp(`^${escapeRegex(data.businessName)}$`, "i"),
      },
    }).populate("assignedTo", "name role");

    if (existingAccount) {
      return res.status(409).json({
        message: existingAccount.assignedTo
          ? `An account with this business name already exists. It is currently assigned to ${existingAccount.assignedTo.name}.`
          : `An account with this business name already exists.`,
        existingAccount: existingAccount._id,
        assignedTo: existingAccount.assignedTo
          ? {
              name: existingAccount.assignedTo.name,
              role: existingAccount.assignedTo.role,
            }
          : null,
      });
    }

    // Status → isCustomer
    data.isCustomer = data.status === "Customer";

    // ✅ Pricing: multiple services (or legacy single service)
    const rawServices = resolveRawServices(data);
    if (rawServices) {
      await applyServices(data, rawServices);
    }

    const newAccount = new BusinessAccount(data);
    const savedAccount = await newAccount.save();
    const populatedAccount = await BusinessAccount.findById(
      savedAccount._id
    ).populate(populateOptions);

    res.status(201).json(populatedAccount);
  } catch (err) {
    console.error("Error creating business account:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 11000) {
      return res.status(409).json({
        error: "Business name already exists.",
        details: err.message,
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// =========================
// UPDATE account
// =========================
exports.update = async (req, res) => {
  try {
    const data = { ...req.body };

    // Load existing to merge for pricing decisions
    const existing = await BusinessAccount.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Account not found" });
    }

    // Merge old + new
    const merged = {
      ...existing.toObject(),
      ...data,
    };
    delete merged._id;

    merged.isCustomer = merged.status === "Customer";

    // ✅ Pricing: only recalculate when the request includes services
    // (otherwise keep what is already stored)
    const rawServices = resolveRawServices(data);
    if (rawServices) {
      await applyServices(merged, rawServices);
    }

    const updated = await BusinessAccount.findByIdAndUpdate(
      req.params.id,
      merged,
      { new: true, runValidators: true }
    ).populate(populateOptions);

    res.json(updated);
  } catch (err) {
    console.error("Error updating business account:", err);
    if (err.name === "ValidationError") {
      return res.status(400).json({ error: err.message });
    }
    if (err.code === 11000) {
      return res.status(409).json({
        error: "Business name already exists.",
        details: err.message,
      });
    }
    res.status(500).json({ error: err.message });
  }
};

// =========================
// GET quotations-sent accounts
// =========================
exports.getQuotationsSent = async (req, res) => {
  try {
    const quotations = await BusinessAccount.find({
      status: "Quotations",
    }).populate(populateOptions);
    res.json(quotations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =========================
// SOFT DELETE (set Closed)
// =========================
exports.delete = async (req, res) => {
  try {
    const account = await BusinessAccount.findById(req.params.id);
    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    account.status = "Closed";
    account.isCustomer = false;
    await account.save();

    res.status(200).json({ message: "Account status set to Closed", account });
  } catch (err) {
    console.error("Error in soft delete:", err);
    res.status(500).json({
      error: err.message || "Server error during status update",
    });
  }
};

// =========================
// ADD Note
// =========================
exports.addNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, timestamp, author } = req.body;
    const account = await BusinessAccount.findById(id);
    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }
    account.notes.push({ text, timestamp, author });
    await account.save();
    res.status(200).json({
      message: "Note added successfully",
      notes: account.notes,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to add note",
      error: error.message,
    });
  }
};

// =========================
// Quotation stubs
// =========================
exports.addQuotation = async (req, res) => {
  res.status(501).json({ message: "Add quotation not implemented yet." });
};

exports.getQuotations = async (req, res) => {
  res.status(501).json({ message: "Get quotations not implemented yet." });
};

// =========================
// GET follow-ups by account
// =========================
exports.getFollowUpsByAccountId = async (req, res) => {
  try {
    const { id } = req.params;
    const account = await BusinessAccount.findById(id).populate(
      "followUps.addedBy",
      "name"
    );
    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }
    res.json(account.followUps);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching follow-ups",
      error: error.message,
    });
  }
};

// =========================
// ADD follow-up
// =========================
exports.addFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, note, addedBy, status } = req.body;
    const account = await BusinessAccount.findById(id);

    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    account.followUps.push({ date, note, addedBy, status });
    await account.save();

    res.status(201).json({
      message: "Follow-up added successfully",
      followUps: account.followUps,
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to add follow-up",
      error: error.message,
    });
  }
};

// =========================
// UPDATE follow-up by index
// =========================
exports.updateFollowUp = async (req, res) => {
  const { id, index } = req.params;
  const { date, note, status } = req.body;

  try {
    const account = await BusinessAccount.findById(id);
    const followUpIndex = parseInt(index);

    if (!account || isNaN(followUpIndex) || !account.followUps[followUpIndex]) {
      return res.status(404).json({ message: "Follow-up not found" });
    }

    account.followUps[followUpIndex].date = date;
    account.followUps[followUpIndex].note = note;
    account.followUps[followUpIndex].status = status;
    await account.save();

    res.status(200).json({
      message: "Follow-up updated",
      followUps: account.followUps,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error updating follow-up",
      error: error.message,
    });
  }
};

// =========================
// DELETE follow-up by index
// =========================
exports.deleteFollowUp = async (req, res) => {
  const { id, index } = req.params;

  try {
    const account = await BusinessAccount.findById(id);
    const followUpIndex = parseInt(index);

    if (!account || isNaN(followUpIndex) || !account.followUps[followUpIndex]) {
      return res.status(404).json({ message: "Follow-up not found" });
    }

    account.followUps.splice(followUpIndex, 1);
    await account.save();

    res.status(200).json({
      message: "Follow-up deleted",
      followUps: account.followUps,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error deleting follow-up",
      error: error.message,
    });
  }
};

// =========================
// BULK status update
// =========================
exports.bulkStatusUpdate = async (req, res) => {
  try {
    const { ids, status } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        message: "No account IDs provided",
      });
    }

    const updated = await BusinessAccount.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          status,
          isCustomer: status === "Customer" ? true : false,
        },
      }
    );

    return res.status(200).json({
      message: "Bulk update successful",
      updatedCount: updated.modifiedCount,
    });
  } catch (error) {
    console.error("Bulk status update error:", error);
    res.status(500).json({
      message: "Error updating accounts",
      error: error.message,
    });
  }
};