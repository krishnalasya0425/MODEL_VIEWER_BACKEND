import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import vrLauncher from "./routes/vrLauncher.js";
import Grid from "gridfs-stream";
import path from "path";
import fs from "fs";
import helpRoutes from "./routes/helpRoutes.js";
import notificationsRoutes from "./routes/notifications.js";
import { GridFSBucket } from "mongodb";
import uploadRoutes from "./routes/upload.js";
dotenv.config();

const app = express();

app.use(cors({
  origin: '*', // allow all origins
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

app.use(express.json());
// In your main server file (app.js or server.js), add these configurations:
app.use(express.json({ limit: '50gb' }));
app.use(express.urlencoded({ limit: '50gb', extended: true }));
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

const server = app.listen(5000, () => {
  console.log('Server running on port 5000');
});

server.timeout = 300000; // 5 minutes
server.headersTimeout = 300000;