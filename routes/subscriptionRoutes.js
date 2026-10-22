// File: routes/subscriptionRoutes.js

const express = require("express");
const {
  createSubscription,
  getSubscriptionsByBusiness,
  updatePlan,
  cancelSubscription,
  getAllSubscriptions,
  getSubscriptionDetails,
  getSubscriptionById,   // ✅ new
  updateSubscription,    // ✅ new
  deleteSubscription,    // ✅ new
} = require("../controllers/subscriptionController");

const router = express.Router();

/* ---------- STATIC ROUTES FIRST ---------- */
router.get("/all", getAllSubscriptions);
router.post("/", createSubscription);

/* ---------- DYNAMIC / NESTED PATHS (more specific first) ---------- */
router.get("/details/:id", getSubscriptionDetails);          // ⚠️ MUST be before /:id
router.put("/upgrade/:subscriptionId", updatePlan);
router.put("/cancel/:id", cancelSubscription);

/* ---------- EDIT / GET ONE (before /:id catch-all) ---------- */
// Full detail for the edit form. Use a distinct prefix to avoid
// clashing with getSubscriptionsByBusiness("/:id").
router.get("/item/:id", getSubscriptionById);   // GET full detail
router.put("/:id", updateSubscription);          // PUT update
router.delete("/:id", deleteSubscription);       // DELETE

/* ---------- CATCH-ALL LAST ---------- */
// ⚠️ This route is for "list by business id" — keep it LAST so it
// doesn't shadow /details/:id or /item/:id.
router.get("/:id", getSubscriptionsByBusiness);

module.exports = router;