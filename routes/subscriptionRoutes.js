// File: routes/subscriptionRoutes.js

const express = require("express");
const {
  createSubscription,
  getSubscriptionsByBusiness,
  updatePlan,
  cancelSubscription,
  getAllSubscriptions,
  getSubscriptionDetails,
  getSubscriptionById,
  updateSubscription,
  deleteSubscription,
} = require("../controllers/subscriptionController");
const { sendInvoice } = require("../controllers/invoiceController"); // ✅ new

const router = express.Router();

/* ---------- STATIC ROUTES FIRST ---------- */
router.get("/all", getAllSubscriptions);
router.post("/", createSubscription);

/* ---------- DYNAMIC / NESTED PATHS (more specific first) ---------- */
router.get("/details/:id", getSubscriptionDetails);
router.put("/upgrade/:subscriptionId", updatePlan);
router.put("/cancel/:id", cancelSubscription);

/* ---------- INVOICE (before /:id) ---------- */
router.post("/:id/send-invoice", sendInvoice); // ✅ new

/* ---------- EDIT / GET ONE ---------- */
router.get("/item/:id", getSubscriptionById);
router.put("/:id", updateSubscription);
router.delete("/:id", deleteSubscription);

/* ---------- CATCH-ALL LAST ---------- */
router.get("/:id", getSubscriptionsByBusiness);

module.exports = router;