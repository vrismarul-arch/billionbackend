const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/brandServiceController");

// If your other routes use an auth / admin middleware, add it here too, e.g.
// const { protect } = require("../middleware/auth");
// router.put("/reorder", protect, ctrl.reorderServices);

router.get("/", ctrl.getAllServices);
router.post("/", ctrl.createService);

// MUST be before "/:id", otherwise "reorder" is treated as an id
router.put("/reorder", ctrl.reorderServices);

router.get("/:id", ctrl.getServiceById);
router.put("/:id", ctrl.updateService);
router.delete("/:id", ctrl.deleteService);

// Notes
router.put("/:id/notes", ctrl.updateServiceNotes);

// Plans (keep these paths the same as your existing routes)
router.post("/:id/plans", ctrl.addPlan);
router.put("/:serviceId/plans/:planId", ctrl.updatePlan);
router.delete("/:serviceId/plans/:planId", ctrl.deletePlan);

module.exports = router;