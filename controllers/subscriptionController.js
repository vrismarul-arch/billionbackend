// File: controllers/subscriptionController.js

const Subscription = require("../models/Subscription");
const BusinessAccount = require("../models/BusinessAccount");
const BrandService = require("../models/BrandService");
const { sendAlert } = require("./alertController");

/* ---------- helper: resolve plan subdoc from stored fields ---------- */
const resolvePlanFromSubscription = (subscription) => {
  const service = subscription.service;
  if (!service || !Array.isArray(service.plans)) return null;

  // 1) exact _id match
  if (subscription.currentPlan) {
    const byId = service.plans.find(
      (p) => String(p._id) === String(subscription.currentPlan)
    );
    if (byId) return byId;
  }
  // 2) name fallback (old records without currentPlan)
  if (subscription.planName) {
    return service.plans.find((p) => p.name === subscription.planName) || null;
  }
  return null;
};

/* ---------- helper: alert receiver ---------- */
const getAlertReceiverUserId = async (businessAccountId) => {
  const business = await BusinessAccount.findById(businessAccountId)
    .populate("owner", "_id")
    .populate("clients", "_id");

  if (business?.owner?._id) return business.owner._id;
  if (business?.clients?.length > 0) return business.clients[0]._id;
  return null;
};

/* =====================================================================
   CREATE
   ===================================================================== */
exports.createSubscription = async (req, res) => {
  try {
    const {
      businessAccount,
      service,
      planId,
      billingCycle,
      amountPaid,
      gstRate,
      orderId,
      paymentId,
    } = req.body;

    if (!businessAccount || !service || !planId)
      return res.status(400).json({ message: "Missing required fields" });

    const serviceDoc = await BrandService.findById(service);
    if (!serviceDoc) return res.status(404).json({ message: "Service Not Found" });

    const plan = serviceDoc.plans.id(planId);
    if (!plan) return res.status(404).json({ message: "Plan Not Found" });

    const finalGstRate = Number(gstRate) > 0 ? Number(gstRate) : 18;
    const paid = Number(amountPaid) || 0;
    const totalWithGST = Math.round(paid + (paid * finalGstRate) / 100);

    let renewalDate = new Date();
    if (billingCycle === "Monthly") {
      renewalDate.setMonth(renewalDate.getMonth() + 1);
    } else {
      renewalDate.setMonth(renewalDate.getMonth() + 12);
    }

    const subscription = await Subscription.create({
      businessAccount,
      service,
      currentPlan: plan._id,        // ✅ store plan subdoc id
      planName: plan.name,
      planPriceMonthly: plan.priceMonthly,
      planPriceYearly: plan.priceYearly,
      planPriceOneTime: plan.priceOneTime || 0,
      billingCycle,
      amountPaid: paid,
      gstRate: finalGstRate,
      totalWithGST,
      orderId,
      paymentId,
      renewalDate,
      status: "active",
      autoRenew: billingCycle !== "One Time",
    });

    // mirror onto business account
    await BusinessAccount.findByIdAndUpdate(businessAccount, {
      selectedService: service,
      selectedPlan: planId,
      billingCycle,
      totalPrice: totalWithGST,
      gstRate: finalGstRate,
      isCustomer: true,
      status: "Customer",
    });

    // alert
    const receiverId = await getAlertReceiverUserId(businessAccount);
    if (receiverId) {
      await sendAlert({
        userId: receiverId,
        message: `Subscription Activated - ${plan.name}`,
        type: "Subscription",
        refId: subscription._id,
      });
    }

    const created = await Subscription.findById(subscription._id)
      .populate("businessAccount", "businessName contactName")
      .populate("service", "serviceName gstRate");

    res.status(201).json(created);
  } catch (error) {
    console.error("Create Subscription Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* =====================================================================
   LIST (admin)
   ✅ returns planId + serviceId on every row so the UI can edit
   ===================================================================== */
exports.getAllSubscriptions = async (req, res) => {
  try {
    const data = await Subscription.find()
      .populate("businessAccount", "businessName contactName")
      .populate("service", "serviceName gstRate plans")
      .sort({ createdAt: -1 })
      .lean();

    // attach planId resolved from name/id
    const enriched = data.map((sub) => {
      const plan = resolvePlanFromSubscription(sub);
      return {
        ...sub,
        planId: plan?._id || null,
      };
    });

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =====================================================================
   LIST by business
   ===================================================================== */
exports.getSubscriptionsByBusiness = async (req, res) => {
  try {
    const subs = await Subscription.find({
      businessAccount: req.params.id,
    }).populate("service", "serviceName plans");

    res.json(subs);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch subscriptions" });
  }
};

/* =====================================================================
   GET one subscription (FULL — used by edit form)
   ✅ returns everything the frontend needs to prefill the drawer
   ===================================================================== */
exports.getSubscriptionById = async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.id)
      .populate("businessAccount", "businessName contactNumber contactEmail")
      .populate("service", "serviceName gstRate plans");

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    const plan = resolvePlanFromSubscription(subscription);

    res.json({
      _id: subscription._id,

      // ids the form needs
      businessAccountId: subscription.businessAccount?._id || null,
      serviceId: subscription.service?._id || null,
      planId: plan?._id || null,

      // display helpers
      businessName: subscription.businessAccount?.businessName || null,
      serviceName: subscription.service?.serviceName || null,
      serviceGstRate: subscription.service?.gstRate ?? null,

      // plan snapshot + resolved plan doc
      planName: subscription.planName,
      plan: plan
        ? {
            _id: plan._id,
            name: plan.name,
            priceMonthly: plan.priceMonthly,
            priceYearly: plan.priceYearly,
            priceOneTime: plan.priceOneTime,
            features: plan.features,
          }
        : null,

      billingCycle: subscription.billingCycle,
      status: subscription.status,
      renewalDate: subscription.renewalDate,
      amountPaid: subscription.amountPaid,
      gstRate: subscription.gstRate,
      totalWithGST: subscription.totalWithGST,
      orderId: subscription.orderId,
      paymentId: subscription.paymentId,

      // original populated refs (in case frontend wants them)
      businessAccount: subscription.businessAccount,
      service: subscription.service,

      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    });
  } catch (error) {
    console.error("getSubscriptionById error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* =====================================================================
   GET details (kept for backward compat — same shape as before + planId)
   ===================================================================== */
exports.getSubscriptionDetails = async (req, res) => {
  try {
    const subscription = await Subscription.findById(req.params.id)
      .populate("service", "serviceName gstRate plans")
      .populate("businessAccount", "businessName contactNumber contactEmail");

    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    const selectedPlan = resolvePlanFromSubscription(subscription);

    res.json({
      _id: subscription._id,
      businessName: subscription.businessAccount?.businessName,
      serviceName: subscription.service?.serviceName,
      serviceId: subscription.service?._id || null,
      billingCycle: subscription.billingCycle,
      status: subscription.status,
      renewalDate: subscription.renewalDate,
      amountPaid: subscription.amountPaid,
      gstRate: subscription.gstRate,
      totalWithGST: subscription.totalWithGST,
      orderId: subscription.orderId,
      planName: subscription.planName,
      planId: selectedPlan?._id || null,
      planFeatures: selectedPlan?.features || [],
    });
  } catch (error) {
    console.error("Details Fetch Error:", error);
    res.status(500).json({ message: error.message });
  }
};

/* =====================================================================
   UPDATE (PUT) — used by the edit drawer
   Accepts full payload same as create.
   ===================================================================== */
exports.updateSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      businessAccount,
      service,
      planId,
      billingCycle,
      amountPaid,
      gstRate,
    } = req.body;

    const subscription = await Subscription.findById(id);
    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    // Resolve service + plan
    const serviceDoc = await BrandService.findById(service || subscription.service);
    if (!serviceDoc) return res.status(404).json({ message: "Service Not Found" });

    const targetPlanId = planId || subscription.currentPlan;
    const plan = serviceDoc.plans.id(targetPlanId);
    if (!plan) return res.status(404).json({ message: "Plan Not Found" });

    const finalGstRate =
      Number(gstRate) > 0
        ? Number(gstRate)
        : Number(serviceDoc.gstRate) > 0
        ? Number(serviceDoc.gstRate)
        : 18;

    const paid = Number(amountPaid ?? subscription.amountPaid) || 0;
    const totalWithGST = Math.round(paid + (paid * finalGstRate) / 100);

    const cycle = billingCycle || subscription.billingCycle;
    let renewalDate = subscription.renewalDate || new Date();
    // recompute renewal if cycle changed
    if (cycle !== subscription.billingCycle) {
      renewalDate = new Date();
      if (cycle === "Monthly") renewalDate.setMonth(renewalDate.getMonth() + 1);
      else renewalDate.setMonth(renewalDate.getMonth() + 12);
    }

    // push history if plan name changed
    if (subscription.planName !== plan.name) {
      subscription.history.push({
        previousPlanName: subscription.planName,
        newPlanName: plan.name,
        note: "Updated via edit",
      });
    }

    // apply updates
    subscription.businessAccount = businessAccount || subscription.businessAccount;
    subscription.service = serviceDoc._id;
    subscription.currentPlan = plan._id;
    subscription.planName = plan.name;
    subscription.planPriceMonthly = plan.priceMonthly;
    subscription.planPriceYearly = plan.priceYearly;
    subscription.planPriceOneTime = plan.priceOneTime || 0;
    subscription.billingCycle = cycle;
    subscription.amountPaid = paid;
    subscription.gstRate = finalGstRate;
    subscription.totalWithGST = totalWithGST;
    subscription.renewalDate = renewalDate;
    subscription.autoRenew = cycle !== "One Time";

    await subscription.save();

    // mirror onto the business account
    await BusinessAccount.findByIdAndUpdate(subscription.businessAccount, {
      selectedService: serviceDoc._id,
      selectedPlan: plan._id,
      billingCycle: cycle,
      totalPrice: totalWithGST,
      gstRate: finalGstRate,
      isCustomer: true,
      status: "Customer",
    });

    // alert
    const receiverId = await getAlertReceiverUserId(subscription.businessAccount);
    if (receiverId) {
      await sendAlert({
        userId: receiverId,
        message: `Subscription Updated - ${plan.name}`,
        type: "Subscription",
        refId: subscription._id,
      });
    }

    const updated = await Subscription.findById(subscription._id)
      .populate("businessAccount", "businessName")
      .populate("service", "serviceName gstRate plans");

    const resolvedPlan = resolvePlanFromSubscription(updated);

    res.json({
      ...updated.toObject(),
      planId: resolvedPlan?._id || null,
      serviceId: updated.service?._id || null,
    });
  } catch (error) {
    console.error("updateSubscription error:", error);
    res.status(400).json({ message: error.message });
  }
};

/* =====================================================================
   DELETE
   ===================================================================== */
exports.deleteSubscription = async (req, res) => {
  try {
    const deleted = await Subscription.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Subscription not found" });
    res.json({ message: "Subscription deleted", _id: deleted._id });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =====================================================================
   UPDATE PLAN (unchanged — kept for existing /upgrade route)
   ===================================================================== */
exports.updatePlan = async (req, res) => {
  try {
    const { subscriptionId } = req.params;
    const { planId, changedBy, note, service } = req.body;

    const serviceDoc = await BrandService.findById(service);
    if (!serviceDoc) return res.status(404).json({ message: "Service Not Found" });

    const newPlan = serviceDoc.plans.id(planId);
    if (!newPlan) return res.status(404).json({ message: "Plan Not Found" });

    const subscription = await Subscription.findById(subscriptionId);
    if (!subscription)
      return res.status(404).json({ message: "Subscription Not Found" });

    const oldPlanName = subscription.planName;

    subscription.history.push({
      previousPlanName: oldPlanName,
      newPlanName: newPlan.name,
      changedBy,
      note,
    });

    subscription.currentPlan = newPlan._id; // ✅ store id
    subscription.planName = newPlan.name;
    subscription.planPriceMonthly = newPlan.priceMonthly;
    subscription.planPriceYearly = newPlan.priceYearly;
    subscription.planPriceOneTime = newPlan.priceOneTime || 0;

    await subscription.save();

    const receiverId = await getAlertReceiverUserId(subscription.businessAccount);
    if (receiverId) {
      await sendAlert({
        userId: receiverId,
        message: `Subscription Plan Updated: ${oldPlanName} → ${newPlan.name}`,
        type: "Subscription",
        refId: subscription._id,
      });
    }

    const updated = await Subscription.findById(subscriptionId)
      .populate("service", "serviceName plans");

    res.json({ message: "Plan Updated", subscription: updated });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* =====================================================================
   CANCEL (unchanged)
   ===================================================================== */
exports.cancelSubscription = async (req, res) => {
  try {
    const sub = await Subscription.findByIdAndUpdate(
      req.params.id,
      { status: "cancelled", autoRenew: false },
      { new: true }
    ).populate("service", "serviceName");

    if (!sub) return res.status(404).json({ message: "Subscription not found" });

    const receiverId = await getAlertReceiverUserId(sub.businessAccount);
    if (receiverId) {
      await sendAlert({
        userId: receiverId,
        message: `Subscription Cancelled - ${sub.service?.serviceName || ""}`,
        type: "Subscription",
        refId: sub._id,
      });
    }

    res.json({ message: "Subscription Cancelled", sub });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};