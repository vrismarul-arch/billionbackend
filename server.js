// server.js (FINAL WORKING)
// CHAT + PRESENCE + LEAVE + SOCKET LIVE REFRESH + CRON 

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const cron = require("node-cron");
const connectDB = require("./config/db");

// Auto Overtime Cron
const checkOvertimeAlerts = require("./utils/workOvertimeChecker");
const checkRenewalAlerts = require("./utils/subscriptionRenewalReminder");
const User = require("./models/User");

const app = express();

/* ⭐ CORS — supports Web + Expo Mobile */
const allowedOrigins = [
  "http://localhost:5173",
  "https://cloudcrm.billioncreators.in",
  "http://localhost:8081",
  "http://localhost:19006",
];

const corsOptions = {
  origin: function (origin, callback) {
    // ✅ Allow: no origin (native mobile / Postman)
    // ✅ Allow: whitelisted origins
    // ✅ Allow: Expo LAN — exp://192.168.x.x:xxxx
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      /^exp:\/\/192\.168\.\d+\.\d+/.test(origin)
    ) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS: " + origin));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));
app.use(express.json());

// ⭐ API ROUTES
app.use("/api/events", require("./routes/eventRoutes"));
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/departments", require("./routes/departmentRoutes"));
app.use("/api/teams", require("./routes/teamRoutes"));
app.use("/api/quotations", require("./routes/quotationRoutes"));
app.use("/api/invoices", require("./routes/invoiceRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/accounts", require("./routes/businessAccountRoutes"));
app.use("/api/service", require("./routes/brandServiceRoutes"));
app.use("/api/tasks", require("./routes/taskRoutes"));
app.use("/api/work-sessions", require("./routes/workSessionRoutes"));
app.use("/api/credentials", require("./routes/credentialRoutes"));
app.use("/api/access", require("./routes/userAccessRoutes"));
app.use("/api/projects", require("./routes/projectRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/alerts", require("./routes/alertRoutes"));
app.use("/api/leaves", require("./routes/leaveRoutes"));
app.use("/api/chat", require("./routes/chatRoutes"));
app.use("/api/subscriptions", require("./routes/subscriptionRoutes"));
app.use("/api/workflow", require("./routes/workflowRoutes"));
app.use("/api/steps", require("./routes/processStepRoutes"));
app.use("/api/reports", require("./routes/weeklyReportRoutes"));
app.use("/api/public-holidays", require("./routes/publicHolidayRoutes"));

app.get("/api/test", (req, res) => res.json({ message: "Server OK 🚀" }));

/* =====================================================
      CRON JOBS
===================================================== */

// ⏳ Overtime Check Every 10 Mins
cron.schedule("*/10 * * * *", () => {
  console.log("CRON --> Checking Overtime...");
  checkOvertimeAlerts();
});

// 🔥 Subscription Renewal Reminder Everyday Midnight
cron.schedule("0 0 * * *", () => {
  console.log("CRON --> Checking Subscription Renewals...");
  checkRenewalAlerts();
});

/* =====================================================
      SOCKET.IO SERVER
===================================================== */
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: function (origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        /^exp:\/\/192\.168\.\d+\.\d+/.test(origin)
      ) {
        callback(null, true);
      } else {
        callback(new Error("Socket CORS blocked: " + origin));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

global._io = io;

io.on("connection", (socket) => {
  console.log("🟢 Socket Connected:", socket.id);

  // Employee joins personal socket room
  socket.on("join_room", (userId) => {
    if (userId) {
      socket.join(userId.toString());
      console.log(`📌 joined room ${userId}`);
    }
  });

  // REAL-TIME CHAT
  socket.on("send_message", (msg) => {
    if (!msg?.to) return;
    io.to(msg.to.toString()).emit("new_message", msg);
  });

  // Real-time typing
  socket.on("typing", ({ from, to }) => {
    if (!to) return;
    io.to(to.toString()).emit("typing", { from });
  });

  // PRESENCE UPDATE
  socket.on("presence_change", async ({ userId, presence }) => {
    if (!userId) return;

    await User.findByIdAndUpdate(userId, {
      presence,
      lastActiveAt: new Date(),
    });

    io.emit("presence_updated", { userId, presence });
  });

  // ⭐ LEAVE LIVE REFRESH
  socket.on("leave_applied", () => {
    io.emit("leave_list_refresh");
  });

  socket.on("leave_updated", () => {
    io.emit("leave_list_refresh");
  });

  socket.on("disconnect", () => {
    console.log("🔴 Socket Disconnected:", socket.id);
  });
});

/* START SERVER */
connectDB().then(() => {
  const PORT = process.env.PORT || 1001;
  httpServer.listen(PORT, () =>
    console.log(`🔥 API + SOCKET running on PORT ${PORT}`)
  );
});