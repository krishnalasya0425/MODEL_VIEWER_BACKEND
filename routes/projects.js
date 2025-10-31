import express from "express";
import mongoose from "mongoose";
import Project from "../models/Project.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import upload from "../middleware/upload.js"; // import here safely

const router = express.Router();

// GET ALL PROJECTS

router.get("/my-projects", async (req, res) => {
  try {
    const { userId } = req.query;
    console.log("Query received:", req.query);

    const projects = await Project.find().populate("createdBy", "email role");
    console.log("Projects found:", projects.length);

    if (!userId) return res.json(projects);

    const assignedProjects = projects.filter((p) => {
      const assignedArray = Array.isArray(p.assignedTo) ? p.assignedTo : [];
      return assignedArray.map((a) => a.toString()).includes(userId);
    });

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
    console.error("Error in /my-projects route:", err);
    res.status(500).json({ error: err.message });
  }
});



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
    // Check extension and set correct MIME type
    if (ext === "glb") contentType = "model/gltf-binary";
    else if (ext === "gltf") contentType = "model/gltf+json";
    else if (ext === "fbx") contentType = "application/octet-stream";
    else if (!contentType) contentType = "application/octet-stream";

    /* ✅ FIX: Full header set for Three.js + <model-viewer> texture access */
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");

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
      res.status(200);
      res.setHeader("Content-Length", filesCollection.length);
      res.setHeader("Accept-Ranges", "bytes");
      const stream = bucket.openDownloadStream(_id);
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        res.status(500).end();
      });
      stream.on("end", () => res.end());
      stream.pipe(res, { end: true });
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

/* ------------------ ✅ UPDATE PROJECT ------------------ */
router.put(
  "/:id",
  upload.fields([{ name: "modelFile" }, { name: "subModelFiles" }]),
  async (req, res) => {
    try {
      const projectId = req.params.id;
      console.log("🟢 UPDATE REQUEST BODY:", req.body);
      console.log("🟢 UPDATE FILES:", req.files);
      if (!mongoose.Types.ObjectId.isValid(projectId))
        return res.status(400).json({ error: "Invalid project ID" });

      const existingProject = await Project.findById(projectId);
      if (!existingProject)
        return res.status(404).json({ error: "Project not found" });

      const { name, description, modelName, subModels } = req.body;
      let parsedSubModels = [];
      if (subModels) parsedSubModels = JSON.parse(subModels);

      // Handle updated main model file
      if (req.files.modelFile && req.files.modelFile[0]) {
        existingProject.modelFileId = req.files.modelFile[0].id;
        existingProject.modelFileName = req.files.modelFile[0].originalname;
        existingProject.modelFileContentType = req.files.modelFile[0].mimetype;
      }

      // Handle updated submodel files
      if (req.files.subModelFiles && parsedSubModels.length) {
        req.files.subModelFiles.forEach((file, index) => {
          if (parsedSubModels[index]) {
            parsedSubModels[index].fileId = file.id;
            parsedSubModels[index].fileName = file.originalname;
            parsedSubModels[index].contentType = file.mimetype;
          }
        });
      }

      existingProject.name = name || existingProject.name;
      existingProject.description = description || existingProject.description;
      existingProject.modelName = modelName || existingProject.modelName;
      existingProject.subModels = parsedSubModels.length
        ? parsedSubModels
        : existingProject.subModels;

      await existingProject.save();
      res.json({ message: "Project updated successfully", project: existingProject });
    } catch (err) {
      console.error("Error updating project:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

/* ------------------ ✅ DELETE PROJECT ------------------ */
router.delete("/:id", async (req, res) => {
  try {
    const projectId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(projectId))
      return res.status(400).json({ error: "Invalid project ID" });

    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    // ✅ Unassign users before delete
    project.assignedTo = [];
    await project.save();

    await Project.deleteOne({ _id: projectId });

    res.json({ message: "Project deleted and unassigned successfully" });
  } catch (err) {
    console.error("Error deleting project:", err);
    res.status(500).json({ error: err.message });
  }
});


router.get("/:id", async (req, res) => {
  try {
    const projectId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(projectId))
      return res.status(400).json({ error: "Invalid project ID" });

    const project = await Project.findById(projectId)
      .populate("createdBy", "email role")
      .populate("assignedTo", "email role");

    if (!project) return res.status(404).json({ error: "Project not found" });
    res.json(project);
  } catch (err) {
    console.error("Error fetching project:", err);
    res.status(500).json({ error: err.message });
  }
});


// GET ALL PROJECTS
router.get("/", async (req, res) => {
  try {
    const projects = await Project.find()
      .populate("createdBy", "name email role") // existing
      .populate("assignedTo", "name email role") // 👈 add this line
      .sort({ createdAt: -1 }); // optional: newest first

    res.json(projects);
  } catch (err) {
    console.error("Error fetching projects:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
