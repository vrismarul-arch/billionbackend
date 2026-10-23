
const express = require("express");
const router = express.Router();

const invoiceController = require("../controllers/invoiceController");

router.post("/:id/prepare", invoiceController.prepareInvoice);
router.post("/:id/send", invoiceController.sendInvoice);
router.get("/history/:id", invoiceController.getInvoiceHistory);

module.exports = router;
