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
dotenv.config();

const app = express();

app.use(cors({
  origin: '*', // allow all origins
  methods: ['GET', 'POST','PUT','DELETE'],
  exposedHeaders: ['Content-Length', 'Content-Range']
}));

app.use(express.json());

const PUBLIC_DIR = path.join(process.cwd(), "public", "models");
app.use("/models", express.static(PUBLIC_DIR));

const mongoURI = process.env.MONGO_URI;

const conn = mongoose.createConnection(mongoURI);
let gfs;
conn.once("open", () => {
  gfs = Grid(conn.db, mongoose.mongo);
  gfs.collection("uploads");
  app.set("gfs", gfs); // attach gfs to app so routes can use it
});

app.use("/api/auth", authRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/system", vrLauncher);

const PORT = process.env.PORT || 5000;
mongoose
  .connect(mongoURI)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => console.log(err));