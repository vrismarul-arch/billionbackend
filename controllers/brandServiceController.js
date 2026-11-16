const mongoose = require("mongoose");
const BrandService = require("../models/BrandService");
const { v4: uuidv4 } = require("uuid");

// GET ALL (saved drag-and-drop order first)
exports.getAllServices = async (req, res) => {
  try {
    const services = await BrandService.find().sort({ order: 1, createdAt: -1 });
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: "Failed" });
  }
};

// GET BY ID
exports.getServiceById = async (req, res) => {
  try {
    const service = await BrandService.findById(req.params.id);
    if (!service) return res.status(404).json({ error: "Not Found" });
    res.json(service);
  } catch {
    res.status(500).json({ error: "Failed" });
  }
};

// CREATE SERVICE (new service goes to the end of the list)
exports.createService = async (req, res) => {
  try {
    const last = await BrandService.findOne().sort({ order: -1 }).select("order");
    const nextOrder = last ? (last.order || 0) + 1 : 0;

    const newService = new BrandService({
      ...req.body,
      service_id: uuidv4(),
      order: nextOrder,
    });
    const saved = await newService.save();
    res.status(201).json(saved);
  } catch {
    res.status(400).json({ error: "Create failed" });
  }
};

// UPDATE SERVICE
exports.updateService = async (req, res) => {
  try {
    // order is only changed through /reorder
    const { order, ...body } = req.body;
    const updated = await BrandService.findByIdAndUpdate(req.params.id, body, {
      new: true,
    });
    if (!updated) return res.status(404).json({ error: "Not Found" });
    res.json(updated);
  } catch {
    res.status(400).json({ error: "Update failed" });
  }
};

// DELETE SERVICE
exports.deleteService = async (req, res) => {
  try {
    await BrandService.findByIdAndDelete(req.params.id);
    res.json({ message: "Service deleted" });
  } catch {
    res.status(400).json({ error: "Delete failed" });
  }
};

// REORDER SERVICES  (PUT /api/service/reorder)
// body: { orderedIds: ["id1", "id2", ...] }
exports.reorderServices = async (req, res) => {
  try {
    const { orderedIds } = req.body;

    if (
      !Array.isArray(orderedIds) ||
      orderedIds.length === 0 ||
      !orderedIds.every((id) => mongoose.Types.ObjectId.isValid(id))
    ) {
      return res
        .status(400)
        .json({ error: "orderedIds must be a list of valid ids" });
    }

    const ops = orderedIds.map((id, index) => ({
      updateOne: {
        filter: { _id: id },
        update: { $set: { order: index } },
      },
    }));

    await BrandService.bulkWrite(ops);
    res.json({ message: "Order updated" });
  } catch (err) {
    console.error("Reorder failed:", err);
    res.status(500).json({ error: "Reorder failed" });
  }
};

//
// PLAN MANAGEMENT
//

// ADD PLAN
exports.addPlan = async (req, res) => {
  try {
    const service = await BrandService.findById(req.params.id);
    if (!service) return res.status(404).json({ error: "Not Found" });

    service.plans.push(req.body);
    await service.save();
    res.json({ message: "Plan added", service });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Add failed" });
  }
};

// UPDATE PLAN
exports.updatePlan = async (req, res) => {
  try {
    const { serviceId, planId } = req.params;
    const service = await BrandService.findById(serviceId);
    if (!service) return res.status(404).json({ error: "Not Found" });

    const plan = service.plans.id(planId);
    if (!plan) return res.status(404).json({ error: "Plan Not Found" });

    Object.assign(plan, req.body);
    await service.save();

    res.json({ message: "Plan updated", service });
  } catch {
    res.status(500).json({ error: "Update failed" });
  }
};

// DELETE PLAN
exports.deletePlan = async (req, res) => {
  try {
    const { serviceId, planId } = req.params;
    const service = await BrandService.findById(serviceId);
    if (!service) return res.status(404).json({ error: "Service Not Found" });

    const plan = service.plans.id(planId);
    if (!plan) return res.status(404).json({ error: "Plan Not Found" });

    plan.deleteOne();
    await service.save();

    res.json({ message: "Plan deleted", service });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Delete failed" });
  }
};

// PUT update service notes
exports.updateServiceNotes = async (req, res) => {
  try {
    const { notes } = req.body; // notes array from request body
    const updatedService = await BrandService.findByIdAndUpdate(
      req.params.id,
      { notes: notes }, // Update only the notes field
      { new: true, runValidators: true }
    );
    if (!updatedService) {
      return res.status(404).json({ error: "Service not found." });
    }
    res.json(updatedService);
  } catch (err) {
    console.error("Error updating service notes:", err);
    res.status(400).json({ error: "Failed to update service notes." });
  }
};