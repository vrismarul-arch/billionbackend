// File: routes/subscriptionRoutes.js

const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/subscriptionController");

/* LIST */
router.get("/all", ctrl.getAllSubscriptions);
router.get("/business/:id", ctrl.getSubscriptionsByBusiness);

/* SINGLE — /item/:id must come before /:id */
router.get("/item/:id", ctrl.getSubscriptionById);
router.get("/details/:id", ctrl.getSubscriptionDetails);
router.get("/:id", ctrl.getSubscriptionById);

/* CREATE */
router.post("/", ctrl.createSubscription);

/* UPDATE (edit drawer) */
router.put("/:id", ctrl.updateSubscription);

/* PLAN UPGRADE */
router.put("/upgrade/:subscriptionId", ctrl.updatePlan);

/* CANCEL / DELETE */
router.patch("/cancel/:id", ctrl.cancelSubscription);
router.delete("/:id", ctrl.deleteSubscription);

module.exports = router;