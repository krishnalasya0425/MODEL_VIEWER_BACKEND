import express from "express";
import mongoose from "mongoose";
import Project from "../models/Project.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import upload from "../middleware/upload.js"; // import here safely

const router = express.Router();

router.post(
  "/create",
  upload.fields([{ name: "modelFile" }, { name: "subModelFiles" }]),
  async (req, res) => {
    try {
      const { name, description, modelName, subModels } = req.body;

      let parsedSubModels = [];
      if (subModels) parsedSubModels = JSON.parse(subModels);

      // Handle main model file
      let modelFileId = null;
      let modelFileName = "";
      let modelFileContentType = "";

      if (req.files.modelFile && req.files.modelFile[0]) {
        modelFileId = req.files.modelFile[0].id;
        modelFileName = req.files.modelFile[0].originalname;
        modelFileContentType = req.files.modelFile[0].mimetype;
      }

      // Handle submodel files - FIXED: Properly map files to submodels
      if (req.files.subModelFiles) {
        // Ensure we have the same number of files as submodels
        req.files.subModelFiles.forEach((file, index) => {
          if (parsedSubModels[index]) {
            parsedSubModels[index].fileId = file.id;
            parsedSubModels[index].fileName = file.originalname;
            parsedSubModels[index].contentType = file.mimetype;
          }
        });
      }

      // Initialize any submodels without files
      parsedSubModels = parsedSubModels.map((subModel) => ({
        ...subModel,
        fileId: subModel.fileId || null,
        fileName: subModel.fileName || "",
        contentType: subModel.contentType || "",
      }));

      const project = new Project({
        name,
        description,
        modelName,
        modelFileId,
        modelFileName,
        modelFileContentType,
        subModels: parsedSubModels,
        createdBy: req.user ? req.user.id : null,
      });

      await project.save();
      res.status(201).json(project);
    } catch (err) {
      console.error("Error creating project:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// Display working but slow
router.get("/file/:id", async (req, res) => {
  try {
    const fileId = req.params.id;
     if (!fileId || fileId === "undefined") {
      console.error("❌ Invalid fileId received:", fileId);
      return res.status(400).json({ error: "Invalid file ID" });
    }
    const _id = new mongoose.Types.ObjectId(fileId);

    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: "fs",
    });

    const filesCollection = await mongoose.connection.db
      .collection("fs.files")
      .findOne({ _id });

    if (!filesCollection)
      return res.status(404).json({ error: "File not found" });

    const ext = filesCollection.filename.split(".").pop().toLowerCase();
    let contentType = filesCollection.contentType;

    // Check extension and set correct MIME type
    if (ext === "glb") contentType = "model/gltf-binary";
    else if (ext === "gltf") contentType = "model/gltf+json";
    else if (ext === "fbx") contentType = "application/octet-stream";
    else if (!contentType) contentType = "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");

    // For file download
    if (req.query.download === "true") {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filesCollection.filename}"`
      );
    }

    const range = req.headers.range;
    const fileLength = filesCollection.length;

    // No range header, stream the entire file
    if (!range) {
      bucket.openDownloadStream(_id).pipe(res);
      return;
    }

    // Handle range requests for large files
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileLength - 1;
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileLength}`);
    res.setHeader("Content-Length", chunkSize);

    bucket.openDownloadStream(_id, { start, end: end + 1 }).pipe(res);
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: err.message });
  }
});


// GET ALL PROJECTS
router.get("/", async (req, res) => {
  try {
    // If auth middleware is removed, req.user will be undefined
    // Return all projects for now
    const projects = await Project.find().populate("createdBy", "email role");
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Assign project to users
router.post("/:id/assign", async (req, res) => {
  try {
    const projectId = req.params.id;
    let { userIds } = req.body;

    console.log("Assigning project", projectId, "to users:", userIds);

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      return res.status(400).json({ error: "Invalid project ID" });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Ensure userIds is an array
    if (!Array.isArray(userIds)) userIds = [userIds];

    // Convert all IDs to actual ObjectId
    project.assignedTo = userIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    await project.save();

    console.log("Project assigned successfully:", project);
    res.json({ message: "Project assigned successfully", project });
  } catch (err) {
    console.error("Error assigning project:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET PROJECTS ASSIGNED TO A USER
router.get("/my-projects", async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    const projects = await Project.find().populate("createdBy", "email role");

    // Filter projects assigned to this user
    const assignedProjects = projects.filter((p) =>
      p.assignedTo.map((a) => a.toString()).includes(userId)
    );

    // Convert ObjectIds to strings for frontend
    const mappedProjects = assignedProjects.map((p) => ({
      ...p.toObject(),
      modelFileId: p.modelFileId ? p.modelFileId.toString() : null,
      subModels: p.subModels.map((s) => ({
        ...s.toObject(),
        fileId: s.fileId ? s.fileId.toString() : null,
      })),
    }));

    res.json(mappedProjects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
