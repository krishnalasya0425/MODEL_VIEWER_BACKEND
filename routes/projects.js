import express from "express";
import mongoose from "mongoose";
import Project from "../models/Project.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import upload from "../middleware/upload.js"; // import here safely
import combinedUpload, { UNITY_ROOT } from "../middleware/unityMulterConfig.js";
import unzipper from "unzipper";
import { exec } from 'child_process'; // Add this import at the top

const router = express.Router();
import fs from "fs";
import path from "path";





function findExe(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      const exe = findExe(full);
      if (exe) return exe;
    }
    if (f.endsWith(".exe")) return f;
  }
  return null;
}


router.post("/launch-build", async (req, res) => {
  try {
    const { projectId, unityBuildPath } = req.body;

    console.log("🚀 Launch build request received:", { 
      projectId, 
      unityBuildPath
    });

    // Validate input
    if (!projectId) {
      console.log("❌ Missing projectId");
      return res.status(400).json({ 
        error: "Missing required field: projectId" 
      });
    }

    // Verify the project exists
    const project = await Project.findById(projectId);
    if (!project) {
      console.log("❌ Project not found:", projectId);
      return res.status(404).json({ 
        error: "Project not found" 
      });
    }

    console.log("📁 Project data:", {
      name: project.name,
      simulatorType: project.simulatorType,
      storedBuildPath: project.unityBuildPath
    });

    // Reconstruct the full path from project data
    const executableName = unityBuildPath || project.unityBuildPath;
    if (!executableName) {
      console.log("❌ No executable name found");
      return res.status(400).json({ 
        error: "No Unity build executable configured for this project" 
      });
    }

    // Build the project directory path
    const projectDir = path.join(
      UNITY_ROOT, 
      project.simulatorType, 
      project.name.replace(/\s+/g, "_")
    );
    
    const fullExecutablePath = path.join(projectDir, executableName);
    
    console.log("🔍 Path reconstruction:", {
      UNITY_ROOT,
      simulatorType: project.simulatorType,
      projectName: project.name,
      projectDir,
      executableName,
      fullExecutablePath
    });

    // Check if the build file exists
    console.log("🔍 Checking if build file exists:", fullExecutablePath);

    if (!fs.existsSync(fullExecutablePath)) {
      console.log("❌ Build file not found at path:", fullExecutablePath);
      
      // Debug: Check if directory exists and list contents
      if (fs.existsSync(projectDir)) {
        console.log("📁 Directory exists, contents:", fs.readdirSync(projectDir));
        
        // Recursively search for .exe files
        const allExeFiles = [];
        function findExeFiles(dir) {
          const items = fs.readdirSync(dir);
          items.forEach(item => {
            const fullPath = path.join(dir, item);
            if (fs.statSync(fullPath).isDirectory()) {
              findExeFiles(fullPath);
            } else if (item.endsWith('.exe')) {
              allExeFiles.push({
                name: item,
                path: fullPath,
                relative: path.relative(projectDir, fullPath)
              });
            }
          });
        }
        
        findExeFiles(projectDir);
        console.log("🔍 All .exe files found:", allExeFiles);
        
        if (allExeFiles.length > 0) {
          // Use the first .exe found
          const foundExe = allExeFiles[0];
          console.log("🔄 Using found executable:", foundExe);
          
          // Update the project with the relative path
          project.unityBuildPath = foundExe.relative;
          await project.save();
          
          console.log("✅ Updated project with new build path:", foundExe.relative);
          
          // Launch the found executable
          return launchExecutable(foundExe.path, res);
        }
      } else {
        console.log("❌ Project directory doesn't exist:", projectDir);
      }
      
      return res.status(404).json({ 
        error: "Build file not found. It may have been moved or deleted." 
      });
    }

    console.log("✅ Build file found, launching:", fullExecutablePath);
    await launchExecutable(fullExecutablePath, res);

  } catch (error) {
    console.error("❌ Error in launch-build:", error);
    res.status(500).json({ 
      error: "Internal server error: " + error.message 
    });
  }
});

// Helper function to launch executable
function launchExecutable(executablePath, res) {
  return new Promise((resolve) => {
    console.log("🎯 Executing command:", `"${executablePath}"`);
    
    exec(`"${executablePath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('❌ Error launching build:', error);
        console.error('STDERR:', stderr);
        res.status(500).json({ 
          success: false, 
          error: `Failed to launch: ${error.message}` 
        });
      } else {
        console.log('✅ Build launched successfully');
        console.log('STDOUT:', stdout);
        res.json({ 
          success: true, 
          message: "Build launched successfully" 
        });
      }
      resolve();
    });
  });
}
// GET ALL PROJECTS FOR DASHBOARD
router.get("/my-projects", async (req, res) => {
  try {
    const { userId } = req.query;
    console.log("Query received:", req.query);

    // Fetch all projects
    const projects = await Project.find().populate("createdBy", "email role");
    console.log("Projects found:", projects.length);

    // If userId is provided, optionally mark assigned projects (for future use)
    const mappedProjects = projects.map((p) => ({
      ...p.toObject(),
      modelFileId: p.modelFileId ? p.modelFileId.toString() : null,
      subModels: p.subModels.map((s) => ({
        ...s.toObject(),
        fileId: s.fileId ? s.fileId.toString() : null,
      })),
    }));

    // ✅ Return all projects regardless of assignment
    res.json(mappedProjects);
  } catch (err) {
    console.error("Error in /my-projects route:", err);
    res.status(500).json({ error: err.message });
  }
});




router.post(
  "/create",
  authMiddleware,
  combinedUpload.fields([
    { name: "unityZip" },
    { name: "modelFile" },
    { name: "subModelFiles" }
  ]),
  async (req, res) => {
    try {
      let unityBuildPath = null;

      const { name, description, modelName, subModels, category, simulatorType } = req.body;

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

      // Handle submodel files
      if (req.files.subModelFiles) {
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

       if (category === "simulators" && req.files.unityZip) {
        const zipFile = req.files.unityZip[0];
        
        console.log("📦 Processing Unity build zip:", {
          originalName: zipFile.originalname,
          simulatorType: simulatorType
        });

        const projectFolder = path.join(
          UNITY_ROOT,
          simulatorType,
          name.replace(/\s+/g, "_")
        );

        console.log("🎯 Target extraction folder:", projectFolder);

        // Create project folder
        if (fs.existsSync(projectFolder)) {
          fs.rmSync(projectFolder, { recursive: true });
        }
        fs.mkdirSync(projectFolder, { recursive: true });

        // Extract the zip file
        console.log("🔓 Extracting build...");
        await new Promise((resolve, reject) => {
          fs.createReadStream(zipFile.path)
            .pipe(unzipper.Extract({ path: projectFolder }))
            .on('close', () => {
              console.log("✅ Extraction completed");
              resolve();
            })
            .on('error', reject);
        });

        // Find .exe for Unity builds
        console.log("🔍 Searching for executable...");
        const exe = findExe(projectFolder);
        
        if (!exe) {
          console.log("❌ No executable found");
          return res.status(400).json({ 
            error: "No .exe file found in the Unity build." 
          });
        }
        unityBuildPath = exe;

        console.log("✅ Found Unity executable:", unityBuildPath);
      }

      const project = new Project({
        name,
        description,
        modelName,
        modelFileId,
        modelFileName,
        category,
        simulatorType: simulatorType || null,
        unityBuildPath,
        modelFileContentType,
        subModels: parsedSubModels,
        createdBy: req.user ? req.user.id : null,
        assignedTo: [],
      });

      await project.save();
      console.log("✅ Project saved successfully");
      res.status(201).json(project);
    } catch (err) {
      console.error("❌ Error creating project:", err);
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

      if (!mongoose.Types.ObjectId.isValid(projectId))
        return res.status(400).json({ error: "Invalid project ID" });

      const existingProject = await Project.findById(projectId);
      if (!existingProject)
        return res.status(404).json({ error: "Project not found" });

      const { name, description, modelName, subModels, category } = req.body;
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

      // Update basic fields
      existingProject.name = name || existingProject.name;
      existingProject.description = description || existingProject.description;
      existingProject.modelName = modelName || existingProject.modelName;
      if (category) existingProject.category = category;
      existingProject.subModels = parsedSubModels.length
        ? parsedSubModels
        : existingProject.subModels;

      // Ensure assignedTo remains empty (no specific assignment)
      existingProject.assignedTo = [];

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
