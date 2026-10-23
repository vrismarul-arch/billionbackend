
const mongoose = require("mongoose");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const Subscription = require("../models/Subscription");
const InvoiceLog = require("../models/InvoiceLog");
const InvoiceCounter = require("../models/InvoiceCounter");
const { sendMail } = require("../utils/mailer");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

const getCustomerEmail = (customer) => {
  const email = customer?.contactEmail || customer?.email;
  return typeof email === "string" ? email.trim() : "";
};

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const getCustomerDetails = (subscription) => {
  const customer = subscription.businessAccount;

  return {
    customer,
    name:
      customer?.contactName ||
      customer?.businessName ||
      "Customer",
    email: getCustomerEmail(customer),
    contact: customer?.contactNumber || "",
  };
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });

const formatAmount = (amount) =>
  Number(amount).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const populateSubscription = (id) =>
  Subscription.findById(id)
    .populate(
      "businessAccount",
      "businessName contactName contactNumber contactEmail email"
    )
    .populate("service");

const writeInvoiceLog = async (data) => {
  try {
    await InvoiceLog.create(data);
  } catch (error) {
    console.error("Invoice log error:", error.message);
  }
};

// --------------------------------------------------
// SEQUENTIAL INVOICE NUMBER GENERATOR
// BILL001, BILL002, BILL003...
//
// Counter resets to zero after invoice deletion.
// Existing numbers are checked to prevent reuse.
// --------------------------------------------------

const getInvoiceNumber = async () => {
  for (let attempt = 0; attempt < 10000; attempt++) {
    const counter = await InvoiceCounter.findOneAndUpdate(
      { _id: "invoice" },
      { $inc: { sequence: 1 } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    const candidate =
      `BILL${String(counter.sequence).padStart(3, "0")}`;

    // Never reuse a number still assigned to an invoice.
    const existing = await Subscription.exists({
      invoiceNo: candidate,
    });

    if (!existing) {
      return candidate;
    }
  }

  throw new Error("Unable to allocate a unique invoice number");
};

// --------------------------------------------------
// 1. PREPARE INVOICE + RAZORPAY PAYMENT LINK
// POST /api/invoices/:id/prepare
// --------------------------------------------------

exports.prepareInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid subscription ID",
      });
    }

    const subscription = await populateSubscription(id);

    if (!subscription) {
      return res.status(404).json({
        message: "Subscription not found",
      });
    }

    const { customer, name, email, contact } =
      getCustomerDetails(subscription);

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        message: "A valid customer email is required",
      });
    }

    const totalAmount =
      subscription.totalWithGST ?? subscription.amountPaid;

    if (
      !Number.isFinite(Number(totalAmount)) ||
      Number(totalAmount) <= 0
    ) {
      return res.status(400).json({
        message: "Invalid invoice amount",
      });
    }

    if (!subscription.invoiceNo) {
      subscription.invoiceNo = await getInvoiceNumber();
    }

    // Reuse the existing unpaid payment link.
    if (
      subscription.paymentLinkId &&
      subscription.paymentLinkUrl &&
      subscription.invoicePaymentStatus === "pending"
    ) {
      return res.status(200).json({
        message: "Existing payment link retrieved",
        subscriptionId: subscription._id,
        invoiceNo: subscription.invoiceNo,
        customerEmail: email,
        amount: Number(totalAmount),
        currency: "INR",
        paymentLinkId: subscription.paymentLinkId,
        paymentLinkUrl: subscription.paymentLinkUrl,
        invoicePaymentStatus: subscription.invoicePaymentStatus,
      });
    }

    const paymentLink = await razorpay.paymentLink.create({
      amount: Math.round(Number(totalAmount) * 100),
      currency: "INR",
      accept_partial: false,
      reference_id: String(subscription._id).slice(0, 40),
      description: `Invoice ${subscription.invoiceNo}`,
      customer: {
        name,
        email,
        ...(contact
          ? { contact: String(contact).replace(/\D/g, "") }
          : {}),
      },
      notify: {
        email: false,
        sms: false,
      },
      reminder_enable: false,
      notes: {
        subscriptionId: String(subscription._id),
        invoiceNo: subscription.invoiceNo,
      },
    });

    subscription.paymentLinkId = paymentLink.id;
    subscription.paymentLinkUrl = paymentLink.short_url;
    subscription.invoicePaymentStatus = "pending";

    await subscription.save();

    await writeInvoiceLog({
      subscription: subscription._id,
      businessAccount: customer?._id,
      invoiceNo: subscription.invoiceNo,
      action: "payment_link_created",
      amount: Number(totalAmount),
      sentTo: email,
      paymentLinkUrl: paymentLink.short_url,
      note: "Razorpay payment link created",
    });

    return res.status(200).json({
      message: "Invoice prepared successfully",
      subscriptionId: subscription._id,
      invoiceNo: subscription.invoiceNo,
      customerEmail: email,
      amount: Number(totalAmount),
      currency: "INR",
      paymentLinkId: paymentLink.id,
      paymentLinkUrl: paymentLink.short_url,
      invoicePaymentStatus: subscription.invoicePaymentStatus,
    });
  } catch (error) {
    console.error("Prepare invoice error:", error);

    return res.status(500).json({
      message: "Failed to prepare invoice",
      error: error.error?.description || error.message,
    });
  }
};

// --------------------------------------------------
// 2. SEND INVOICE PDF BY EMAIL
// POST /api/invoices/:id/send
// Body: { pdfBase64: "..." }
// --------------------------------------------------

exports.sendInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { pdfBase64 } = req.body || {};

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid subscription ID",
      });
    }

    if (
      typeof pdfBase64 !== "string" ||
      !pdfBase64.trim()
    ) {
      return res.status(400).json({
        message: "Invoice PDF is required",
      });
    }

    const subscription = await populateSubscription(id);

    if (!subscription) {
      return res.status(404).json({
        message: "Subscription not found",
      });
    }

    const { customer, name, email } =
      getCustomerDetails(subscription);

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        message: "A valid customer email is required",
      });
    }

    if (!subscription.invoiceNo) {
      subscription.invoiceNo = await getInvoiceNumber();
    }

    const cleanBase64 = pdfBase64
      .replace(/^data:application\/pdf;base64,/i, "")
      .replace(/\s/g, "");

    const pdfBuffer = Buffer.from(cleanBase64, "base64");

    if (
      !pdfBuffer.length ||
      pdfBuffer.subarray(0, 4).toString() !== "%PDF"
    ) {
      return res.status(400).json({
        message: "Invalid PDF file",
      });
    }

    const amount =
      subscription.totalWithGST ??
      subscription.amountPaid ??
      0;

    const paymentLink = subscription.paymentLinkUrl
      ? `
        <table role="presentation" cellspacing="0"
               cellpadding="0" border="0"
               style="margin:28px auto;">
          <tr>
            <td bgcolor="#111111" align="center"
                style="border-radius:4px;">
              <a href="${escapeHtml(subscription.paymentLinkUrl)}"
                 style="display:inline-block;padding:15px 38px;
                        color:#ffffff;text-decoration:none;
                        font-family:Arial,sans-serif;font-size:13px;
                        font-weight:bold;letter-spacing:1px;">
                PAY INVOICE &nbsp; &#8594;
              </a>
            </td>
          </tr>
        </table>`
      : `<p style="font-size:13px;color:#555555;">
           Please contact our team for payment details.
         </p>`;

    const paymentContent =
      subscription.invoicePaymentStatus === "paid"
        ? `<p style="padding:15px;background:#f5f5f5;
                     border:1px solid #dddddd;text-align:center;">
             Payment received. Thank you!
           </p>`
        : paymentLink;

    // Premium black-and-white responsive email.
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport"
              content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin:0;padding:0;background:#f3f3f3;
                   font-family:Arial,Helvetica,sans-serif;color:#171717;">
        <table role="presentation" width="100%" cellspacing="0"
               cellpadding="0" style="background:#f3f3f3;">
          <tr>
            <td align="center" style="padding:30px 12px;">
              <table role="presentation" width="600" cellspacing="0"
                     cellpadding="0"
                     style="width:100%;max-width:600px;background:#ffffff;">

                <tr>
                  <td style="background:#111111;padding:30px 36px;">
                    <p style="margin:0;color:#cccccc;font-size:10px;
                              letter-spacing:3px;font-weight:bold;">
                      INVOICE NOTIFICATION
                    </p>
                    <h1 style="margin:18px 0 0;color:#ffffff;font-size:28px;">
                      Invoice ${escapeHtml(subscription.invoiceNo)}
                    </h1>
                    <p style="color:#cccccc;font-size:12px;">
                      Your invoice is ready for review.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:35px 36px 25px;">
                    <p style="font-size:15px;">
                      Hello ${escapeHtml(name)},
                    </p>
                    <p style="font-size:13px;line-height:1.9;color:#555555;">
                      Thank you for your business. Your invoice is
                      attached as a PDF. Please review the summary
                      and complete payment if it is still pending.
                    </p>

                    <table role="presentation" width="100%" cellspacing="0"
                           cellpadding="0"
                           style="border:1px solid #e5e5e5;">
                      <tr>
                        <td colspan="2"
                            style="padding:15px;background:#f7f7f7;
                                   font-size:11px;font-weight:bold;
                                   letter-spacing:1.5px;">
                          INVOICE SUMMARY
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:18px;border-top:1px solid #eee;
                                   font-size:12px;color:#666;">
                          Invoice Number
                        </td>
                        <td align="right"
                            style="padding:18px;border-top:1px solid #eee;
                                   font-size:12px;font-weight:bold;">
                          ${escapeHtml(subscription.invoiceNo)}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:18px;border-top:1px solid #eee;
                                   font-size:12px;color:#666;">
                          Invoice Amount
                        </td>
                        <td align="right"
                            style="padding:18px;border-top:1px solid #eee;
                                   font-size:19px;font-weight:bold;">
                          &#8377;${formatAmount(amount)}
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:18px;border-top:1px solid #eee;
                                   font-size:12px;color:#666;">
                          Payment Status
                        </td>
                        <td align="right"
                            style="padding:18px;border-top:1px solid #eee;
                                   font-size:11px;font-weight:bold;">
                          ${subscription.invoicePaymentStatus === "paid"
                            ? "PAID"
                            : "PAYMENT PENDING"}
                        </td>
                      </tr>
                    </table>

                    <div style="padding-top:20px;text-align:center;">
                      ${paymentContent}
                    </div>

                    <p style="font-size:12px;line-height:1.8;color:#555;">
                      If you have any questions regarding this invoice,
                      please contact our team.
                    </p>
                    <p style="font-size:13px;">Thank you for choosing us.</p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:24px 36px;background:#f7f7f7;
                             border-top:1px solid #e5e5e5;">
                    <p style="font-size:11px;font-weight:bold;
                              letter-spacing:1.5px;">
                      THANK YOU FOR YOUR TRUST
                    </p>
                    <p style="font-size:11px;line-height:1.8;color:#777;">
                      Your invoice is attached as a PDF.
                      Please keep it for your records.
                    </p>
                    <p style="font-size:10px;color:#999;">
                      This is an automated invoice notification.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>`;

    await sendMail({
      to: email,
      subject: `Invoice ${subscription.invoiceNo}`,
      html,
      attachments: [
        {
          filename: `${subscription.invoiceNo}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    subscription.invoiceSentAt = new Date();
    subscription.invoiceSentTo = email;

    await subscription.save();

    await writeInvoiceLog({
      subscription: subscription._id,
      businessAccount: customer?._id,
      invoiceNo: subscription.invoiceNo,
      action: "sent",
      amount: Number(amount),
      sentTo: email,
      paymentLinkUrl: subscription.paymentLinkUrl || "",
      note: "Invoice emailed to customer",
    });

    return res.status(200).json({
      message: "Invoice sent successfully",
      invoiceNo: subscription.invoiceNo,
      sentTo: email,
      invoiceSentAt: subscription.invoiceSentAt,
      paymentLinkUrl: subscription.paymentLinkUrl,
      invoicePaymentStatus: subscription.invoicePaymentStatus,
    });
  } catch (error) {
    console.error("Send invoice error:", error);

    return res.status(500).json({
      message: "Failed to send invoice",
      error: error.message || "Internal server error",
    });
  }
};

// --------------------------------------------------
// 3. RAZORPAY WEBHOOK
// POST /api/invoices/webhook
// Requires raw request body.
// --------------------------------------------------

exports.razorpayWebhook = async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers["x-razorpay-signature"];

    if (!webhookSecret) {
      return res.status(500).json({
        message: "Webhook configuration error",
      });
    }

    if (!signature || !Buffer.isBuffer(req.body)) {
      return res.status(400).json({
        message: "Invalid webhook request",
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(req.body)
      .digest("hex");

    const received = Buffer.from(String(signature), "hex");
    const expected = Buffer.from(expectedSignature, "hex");

    if (
      received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)
    ) {
      return res.status(400).json({
        message: "Invalid webhook signature",
      });
    }

    const eventBody = JSON.parse(req.body.toString("utf8"));

    if (eventBody.event !== "payment_link.paid") {
      return res.status(200).json({
        message: "Webhook event ignored",
        event: eventBody.event,
      });
    }

    const paymentLink =
      eventBody.payload?.payment_link?.entity;

    const payment = eventBody.payload?.payment?.entity;
    const paymentLinkId = paymentLink?.id;

    if (!paymentLinkId) {
      return res.status(400).json({
        message: "Payment link ID missing",
      });
    }

    const subscription = await Subscription.findOne({
      paymentLinkId,
    });

    if (!subscription) {
      return res.status(200).json({
        message: "No matching subscription found",
      });
    }

    const expectedAmount = Math.round(
      Number(
        subscription.totalWithGST ??
        subscription.amountPaid ??
        0
      ) * 100
    );

    const paidAmount = Number(
      paymentLink.amount_paid ?? payment?.amount ?? 0
    );

    if (expectedAmount <= 0 || paidAmount < expectedAmount) {
      return res.status(400).json({
        message: "Paid amount does not match invoice amount",
      });
    }

    if (subscription.invoicePaymentStatus !== "paid") {
      subscription.invoicePaymentStatus = "paid";
      subscription.paidAt = new Date();

      if (payment?.id) {
        subscription.paymentId = payment.id;
      }

      await subscription.save();

      await writeInvoiceLog({
        subscription: subscription._id,
        businessAccount: subscription.businessAccount,
        invoiceNo: subscription.invoiceNo,
        action: "paid",
        amount: expectedAmount / 100,
        paymentLinkUrl: subscription.paymentLinkUrl || "",
        note: "Razorpay payment confirmed by webhook",
      });
    }

    return res.status(200).json({
      message: "Payment status updated",
      invoiceNo: subscription.invoiceNo,
      invoicePaymentStatus: subscription.invoicePaymentStatus,
    });
  } catch (error) {
    console.error("Razorpay webhook error:", error);

    return res.status(500).json({
      message: "Webhook processing failed",
    });
  }
};

// --------------------------------------------------
// 4. GET INVOICE HISTORY
// GET /api/invoices/history/:id
// --------------------------------------------------

exports.getInvoiceHistory = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid subscription ID",
      });
    }

    const subscription = await Subscription.findById(id);

    if (!subscription) {
      return res.status(404).json({
        message: "Subscription not found",
      });
    }

    const history = await InvoiceLog.find({
      subscription: subscription._id,
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      subscriptionId: subscription._id,
      invoiceNo: subscription.invoiceNo,
      invoicePaymentStatus: subscription.invoicePaymentStatus,
      paymentLinkUrl: subscription.paymentLinkUrl,
      invoiceSentTo: subscription.invoiceSentTo,
      invoiceSentAt: subscription.invoiceSentAt,
      paidAt: subscription.paidAt,
      history,
    });
  } catch (error) {
    console.error("Invoice history error:", error);

    return res.status(500).json({
      message: "Failed to fetch invoice history",
      error: error.message,
    });
  }
};

// --------------------------------------------------
// 5. DELETE INVOICE
// DELETE /api/invoices/:id
//
// This removes invoice data from a subscription but keeps
// the subscription record. Counter resets to zero.
// --------------------------------------------------

exports.deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid subscription ID",
      });
    }

    const subscription = await Subscription.findById(id);

    if (!subscription) {
      return res.status(404).json({
        message: "Subscription not found",
      });
    }

    if (!subscription.invoiceNo) {
      return res.status(400).json({
        message: "No invoice exists for this subscription",
      });
    }

    const deletedInvoiceNo = subscription.invoiceNo;

    // Clear invoice-specific fields, retaining the subscription.
    subscription.invoiceNo = undefined;
    subscription.paymentLinkId = undefined;
    subscription.paymentLinkUrl = undefined;
    subscription.invoicePaymentStatus = undefined;
    subscription.invoiceSentAt = undefined;
    subscription.invoiceSentTo = undefined;
    subscription.paidAt = undefined;
    subscription.paymentId = undefined;

    await subscription.save();

    // Preserve audit history; do not delete historical invoice logs.
    await writeInvoiceLog({
      subscription: subscription._id,
      businessAccount: subscription.businessAccount,
      invoiceNo: deletedInvoiceNo,
      action: "deleted",
      note: "Invoice removed; invoice counter reset",
    });

    // Reset counter to zero after any invoice deletion.
    await InvoiceCounter.findOneAndUpdate(
      { _id: "invoice" },
      { $set: { sequence: 0 } },
      {
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(200).json({
      message: "Invoice deleted and counter reset",
      deletedInvoiceNo,
      nextCounterValue: 0,
      note:
        "Existing invoice numbers are retained. " +
        "The next generated number will use the first available BILL number.",
    });
  } catch (error) {
    console.error("Delete invoice error:", error);

    // Duplicate key errors can occur if old records contain duplicates
    // or concurrent requests race. The unique index prevents silent reuse.
    return res.status(error.code === 11000 ? 409 : 500).json({
      message:
        error.code === 11000
          ? "Invoice number conflict. Please retry."
          : "Failed to delete invoice",
      error: error.message,
    });
  }
};
