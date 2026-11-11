
// controllers/businessAccountController.js

const BusinessAccount = require("../models/BusinessAccount");
const BrandService = require("../models/BrandService");
const Quotation = require("../models/Quotation");
const User = require("../models/User");
const mongoose = require("mongoose");

// Common populate options
const populateOptions = [
  { path: "assignedTo", select: "name role" },
  { path: "followUps.addedBy", select: "name" },
  {
    path: "services.service",
    select: "serviceName basePrice gstRate plans",
    model: "BrandService",
  },
  {
    path: "selectedService",
    select: "serviceName basePrice gstRate plans",
    model: "BrandService",
  },
];

// Normalize GST with default 18%
const getEffectiveGstRate = (gstValue) => {
  const num = Number(gstValue);
  if (!num || num < 0) return 18;
  return num;
};

const escapeRegex = (str = "") =>
  String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toId = (value) => value?._id || value || null;

// Calculate price with GST
const calculateTotalPrice = (
  service,
  planId,
  billingCycle = "Monthly"
) => {
  if (!service) return 0;

  let base = 0;

  if (
    planId &&
    mongoose.Types.ObjectId.isValid(planId) &&
    service.plans?.length > 0
  ) {
    const plan = service.plans.id(planId);

    if (plan) {
      if (billingCycle === "Monthly") {
        base = plan.priceMonthly || 0;
      } else if (billingCycle === "Yearly") {
        base = plan.priceYearly || 0;
      } else if (billingCycle === "One Time") {
        base = plan.priceOneTime || 0;
      }
    }
  }

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

const buildServices = async (rawServices = []) => {
  const rows = rawServices.filter((r) => {
    const id = toId(r?.service);
    return id && mongoose.Types.ObjectId.isValid(id);
  });

  if (rows.length === 0) {
    return { services: [], totalPrice: 0 };
  }

  const ids = rows.map((r) => toId(r.service));

  const found = await BrandService.find({
    _id: { $in: ids },
  });

  const byId = new Map(
    found.map((s) => [String(s._id), s])
  );

  let totalPrice = 0;
  const services = [];

  for (const row of rows) {
    const srv = byId.get(String(toId(row.service)));

    if (!srv) continue;

    const planId = toId(row.plan);

    const billingCycle = [
      "Monthly",
      "Yearly",
      "One Time",
    ].includes(row.billingCycle)
      ? row.billingCycle
      : "Monthly";

    const price = calculateTotalPrice(
      srv,
      planId,
      billingCycle
    );

    totalPrice += price;

    services.push({
      service: srv._id,
      plan:
        planId && mongoose.Types.ObjectId.isValid(planId)
          ? planId
          : null,
      billingCycle,
      gstRate: getEffectiveGstRate(srv.gstRate),
      price,
    });
  }

  return { services, totalPrice };
};

const applyServices = async (target, rawServices) => {
  const { services, totalPrice } = await buildServices(
    rawServices
  );

  const first = services[0];

  target.services = services;
  target.totalPrice = totalPrice;

  target.selectedService = first ? first.service : null;
  target.selectedPlan = first ? first.plan : null;
  target.billingCycle = first
    ? first.billingCycle
    : "Monthly";

  target.gstRate = first ? first.gstRate : 18;
};

// =========================
// GET ALL ACCOUNTS
// =========================

exports.getAll = async (req, res) => {
  try {
    const accounts = await BusinessAccount.find().populate(
      populateOptions
    );

    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =========================
// GET PAGINATED ACCOUNTS
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
      teamLeaderId,
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const limit = parseInt(pageSize);

    let query = {};

    if (role === "Employee" && userId) {
      query.assignedTo = userId;
    }

    if (status && status !== "all") {
      query.status = status;
    }

    if (search) {
      query.$or = [
        {
          businessName: {
            $regex: escapeRegex(search),
            $options: "i",
          },
        },
        {
          contactName: {
            $regex: escapeRegex(search),
            $options: "i",
          },
        },
      ];
    }

    const total = await BusinessAccount.countDocuments(query);

    const accounts = await BusinessAccount.find(query)
      .populate(populateOptions)
      .sort({
        [sortBy]: sortOrder === "asc" ? 1 : -1,
      })
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
      error:
        err.message ||
        "Server error fetching paginated accounts",
    });
  }
};

// =========================
// GET ACCOUNT COUNTS
// =========================

exports.getAccountCounts = async (req, res) => {
  try {
    let matchQuery = {};

    if (
      req.query.role === "Employee" &&
      req.query.userId &&
      mongoose.Types.ObjectId.isValid(req.query.userId)
    ) {
      matchQuery.assignedTo = new mongoose.Types.ObjectId(
        req.query.userId
      );
    }

    const counts = await BusinessAccount.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          all: [{ $count: "total" }],
          active: [
            { $match: { status: "Active" } },
            { $count: "total" },
          ],
          Pipeline: [
            { $match: { status: "Pipeline" } },
            { $count: "total" },
          ],
          quotations: [
            { $match: { status: "Quotations" } },
            { $count: "total" },
          ],
          customers: [
            { $match: { status: "Customer" } },
            { $count: "total" },
          ],
          closed: [
            { $match: { status: "Closed" } },
            { $count: "total" },
          ],
          targetLeads: [
            { $match: { status: "TargetLeads" } },
            { $count: "total" },
          ],
        },
      },
      {
        $project: {
          all: { $arrayElemAt: ["$all.total", 0] },
          active: { $arrayElemAt: ["$active.total", 0] },
          Pipeline: {
            $arrayElemAt: ["$Pipeline.total", 0],
          },
          quotations: {
            $arrayElemAt: ["$quotations.total", 0],
          },
          customers: {
            $arrayElemAt: ["$customers.total", 0],
          },
          closed: {
            $arrayElemAt: ["$closed.total", 0],
          },
          targetLeads: {
            $arrayElemAt: ["$targetLeads.total", 0],
          },
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
// GET LEADS BY SOURCE
// =========================

exports.getLeadsBySource = async (req, res) => {
  try {
    const { sourceType } = req.params;

    const leads = await BusinessAccount.find({
      status: { $ne: "Customer" },
      sourceType,
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
// GET ACTIVE LEADS
// =========================

exports.getActiveLeads = async (req, res) => {
  try {
    const leads = await BusinessAccount.find({
      status: "Active",
    }).populate(populateOptions);

    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =========================
// GET CUSTOMERS
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
// GET ACCOUNT BY ID
// =========================

exports.getAccountById = async (req, res) => {
  try {
    const account = await BusinessAccount.findById(
      req.params.id
    ).populate(populateOptions);

    if (!account) {
      return res.status(404).json({
        message: "Account not found",
      });
    }

    const formatted = {
      ...account.toObject(),

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
// CREATE ACCOUNT
// =========================

exports.create = async (req, res) => {
  try {
    const data = { ...req.body };

    const existingAccount = await BusinessAccount.findOne({
      businessName: {
        $regex: new RegExp(
          `^${escapeRegex(data.businessName)}$`,
          "i"
        ),
      },
    }).populate("assignedTo", "name role");

    if (existingAccount) {
      return res.status(409).json({
        message: existingAccount.assignedTo
          ? `An account with this business name already exists. It is currently assigned to ${existingAccount.assignedTo.name}.`
          : "An account with this business name already exists.",

        existingAccount: existingAccount._id,

        assignedTo: existingAccount.assignedTo
          ? {
              name: existingAccount.assignedTo.name,
              role: existingAccount.assignedTo.role,
            }
          : null,
      });
    }

    data.isCustomer = data.status === "Customer";

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
// UPDATE ACCOUNT
// =========================

exports.update = async (req, res) => {
  try {
    const data = { ...req.body };

    const existing = await BusinessAccount.findById(
      req.params.id
    );

    if (!existing) {
      return res.status(404).json({
        message: "Account not found",
      });
    }

    const merged = {
      ...existing.toObject(),
      ...data,
    };

    delete merged._id;

    merged.isCustomer = merged.status === "Customer";

    const rawServices = resolveRawServices(data);

    if (rawServices) {
      await applyServices(merged, rawServices);
    }

    const updated = await BusinessAccount.findByIdAndUpdate(
      req.params.id,
      merged,
      {
        new: true,
        runValidators: true,
      }
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
// GET QUOTATIONS SENT
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
// DELETE ACCOUNT
//
// DELETE /api/accounts/:id
// → Soft delete (status = Closed)
//
// DELETE /api/accounts/:id?permanent=true
// → Permanent delete (no role restriction)
// =========================

exports.delete = async (req, res) => {
  try {
    const { id } = req.params;

    const permanent =
      String(req.query.permanent).toLowerCase() === "true";

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid account id",
      });
    }

    const account = await BusinessAccount.findById(id);

    if (!account) {
      return res.status(404).json({
        message: "Account not found",
      });
    }

    // PERMANENT DELETE - NO ROLE CHECK
    if (permanent) {
      await BusinessAccount.findByIdAndDelete(id);

      return res.status(200).json({
        message: "Account deleted permanently",
        id,
      });
    }

    // SOFT DELETE
    account.status = "Closed";
    account.isCustomer = false;

    await account.save();

    return res.status(200).json({
      message: "Account status set to Closed",
      account,
    });
  } catch (err) {
    console.error("Error deleting account:", err);

    res.status(500).json({
      error: err.message || "Server error during delete",
    });
  }
};

// =========================
// ADD NOTE
// =========================

exports.addNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { text, timestamp, author } = req.body;

    const account = await BusinessAccount.findById(id);

    if (!account) {
      return res.status(404).json({
        message: "Account not found",
      });
    }

    account.notes.push({
      text,
      timestamp,
      author,
    });

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
// QUOTATION STUBS
// =========================

exports.addQuotation = async (req, res) => {
  res.status(501).json({
    message: "Add quotation not implemented yet.",
  });
};

exports.getQuotations = async (req, res) => {
  res.status(501).json({
    message: "Get quotations not implemented yet.",
  });
};

// =========================
// GET FOLLOW-UPS BY ACCOUNT
// =========================

exports.getFollowUpsByAccountId = async (req, res) => {
  try {
    const { id } = req.params;

    const account = await BusinessAccount.findById(id).populate(
      "followUps.addedBy",
      "name"
    );

    if (!account) {
      return res.status(404).json({
        message: "Account not found",
      });
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
// ADD FOLLOW-UP
// =========================

exports.addFollowUp = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, note, addedBy, status } = req.body;

    const account = await BusinessAccount.findById(id);

    if (!account) {
      return res.status(404).json({
        message: "Account not found",
      });
    }

    account.followUps.push({
      date,
      note,
      addedBy,
      status,
    });

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
// UPDATE FOLLOW-UP BY INDEX
// =========================

exports.updateFollowUp = async (req, res) => {
  const { id, index } = req.params;
  const { date, note, status } = req.body;

  try {
    const account = await BusinessAccount.findById(id);
    const followUpIndex = parseInt(index, 10);

    if (
      !account ||
      isNaN(followUpIndex) ||
      !account.followUps[followUpIndex]
    ) {
      return res.status(404).json({
        message: "Follow-up not found",
      });
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
// DELETE FOLLOW-UP BY INDEX
// =========================

exports.deleteFollowUp = async (req, res) => {
  const { id, index } = req.params;

  try {
    const account = await BusinessAccount.findById(id);
    const followUpIndex = parseInt(index, 10);

    if (
      !account ||
      isNaN(followUpIndex) ||
      !account.followUps[followUpIndex]
    ) {
      return res.status(404).json({
        message: "Follow-up not found",
      });
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
// BULK STATUS UPDATE
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
          isCustomer: status === "Customer",
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
