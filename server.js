import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import vrLauncher from "./routes/vrLauncher.js";
import path from "path";
import helpRoutes from "./routes/helpRoutes.js";
import notificationsRoutes from "./routes/notifications.js";
import uploadRoutes from "./routes/upload.js";
import DriveManager from './utils/driveManager.js';
dotenv.config();

const app = express();

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

app.use(express.json());

app.use(express.json({ limit: '50gb' }));
app.use(express.urlencoded({ limit: '50gb', extended: true }));
async function initializeApp() {
  try {
    console.log('🚀 Initializing Unity build storage...');
    await DriveManager.ensureUnityRoot(1); // Reduced to 1GB minimum requirement
    console.log('✅ Unity build storage initialized successfully');
    
    // Start your server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to initialize application:', error);
    process.exit(1);
  }
}

initializeApp();
const PUBLIC_DIR = path.join(process.cwd(), "public", "models");
app.use("/models", express.static(PUBLIC_DIR));

const mongoURI = process.env.MONGO_URI;
let gfsBucket;

mongoose
  .connect(mongoURI)
  .then(() => {
    console.log("MongoDB connected");

    gfsBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: "attachments",
    });

    app.set("gfs", gfsBucket);
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/system", vrLauncher);
app.use("/api/help", helpRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/upload", uploadRoutes);

const PORT = process.env.PORT || 5000;


const monitorMemory = () => {
  const used = process.memoryUsage();
  const memoryInfo = {
    rss: `${Math.round(used.rss / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)} MB`,
    external: `${Math.round(used.external / 1024 / 1024)} MB`,
  };
  console.log("📊 Memory usage:", memoryInfo);
  return memoryInfo;
};


const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`💡 For 4GB memory, run: node --max-old-space-size=4096 server.js`);
  console.log(`💡 Or use: npm run server`);
  

  monitorMemory();
});

server.timeout = 300000; 
server.headersTimeout = 300000;


setInterval(monitorMemory, 5 * 60 * 1000);


const gracefulShutdown = () => {
  console.log('🛑 Server shutting down...');
  monitorMemory();
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);


process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  monitorMemory();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  monitorMemory();
  process.exit(1);
});

export default app;