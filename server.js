
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const cron = require("node-cron");

const connectDB = require("./config/db");
const checkOvertimeAlerts = require("./utils/workOvertimeChecker");
const checkRenewalAlerts = require("./utils/subscriptionRenewalReminder");
const User = require("./models/User");

const app = express();

/* CORS */
const allowedOrigins = [
  "http://localhost:5173",
  "https://cloudcrm.billioncreators.in",
  "http://localhost:8081",
  "http://localhost:19006",
];

const isAllowedOrigin = (origin) => {
  if (!origin || allowedOrigins.includes(origin)) {
    return true;
  }

  // Expo development URLs, for example exp://192.168.1.10:8081
  return /^exp:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(origin);
};

const corsOptions = {
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS: " + origin));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

/* RAZORPAY WEBHOOK
   IMPORTANT: Register before express.json().
   Razorpay signature verification needs the original raw body.
*/
app.post(
  "/api/invoices/webhook",
  express.raw({ type: "application/json" }),
  require("./controllers/invoiceController").razorpayWebhook
);

/* BODY PARSERS */
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

/* API ROUTES */
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

app.get("/api/test", (req, res) => {
  res.json({ message: "Server OK 🚀" });
});

/* CRON JOBS */
cron.schedule("*/10 * * * *", async () => {
  try {
    console.log("CRON --> Checking Overtime...");
    await checkOvertimeAlerts();
  } catch (error) {
    console.error("Overtime cron error:", error);
  }
});

cron.schedule("0 0 * * *", async () => {
  try {
    console.log("CRON --> Checking Subscription Renewals...");
    await checkRenewalAlerts();
  } catch (error) {
    console.error("Subscription renewal cron error:", error);
  }
});

/* SOCKET.IO */
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Socket CORS blocked: " + origin));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

global._io = io;

io.on("connection", (socket) => {
  console.log("🟢 Socket Connected:", socket.id);

  socket.on("join_room", (userId) => {
    if (userId) {
      socket.join(userId.toString());
      console.log(`📌 Joined room ${userId}`);
    }
  });

  socket.on("send_message", (msg) => {
    if (!msg?.to) return;

    io.to(msg.to.toString()).emit("new_message", msg);
  });

  socket.on("typing", ({ from, to } = {}) => {
    if (!to) return;

    io.to(to.toString()).emit("typing", { from });
  });

  socket.on("presence_change", async ({ userId, presence } = {}) => {
    if (!userId) return;

    try {
      await User.findByIdAndUpdate(userId, {
        presence,
        lastActiveAt: new Date(),
      });

      io.emit("presence_updated", { userId, presence });
    } catch (error) {
      console.error("Presence update error:", error);
    }
  });

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
connectDB()
  .then(() => {
    const PORT = process.env.PORT || 1001;

    httpServer.listen(PORT, () => {
      console.log(`🔥 API + SOCKET running on PORT ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database connection failed:", error);
    process.exit(1);
  });
