import express from "express";
import mongoose from "mongoose";
import Project from "../models/Project.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import combinedUpload, { UNITY_ROOT } from "../middleware/unityMulterConfig.js";
import unzipper from "unzipper";
import { exec } from 'child_process';
import fs from "fs";
import path from "path";
import { promisify } from "util";
import stream from "stream";
const router = express.Router();

// Helper function to find executable
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

// Helper function to delete GridFS files
async function deleteGridFSFile(fileId, bucket) {
  try {
    if (!fileId) return;

    // Check if file exists before deleting
    const filesCollection = await mongoose.connection.db.collection("fs.files");
    const fileExists = await filesCollection.findOne({ _id: fileId });

    if (fileExists) {
      await bucket.delete(fileId);
      console.log("✅ Deleted GridFS file:", fileId);

      // Also delete chunks
      const chunksCollection = await mongoose.connection.db.collection("fs.chunks");
      await chunksCollection.deleteMany({ files_id: fileId });
      console.log("✅ Deleted chunks for file:", fileId);
    }
  } catch (error) {
    console.error("❌ Error deleting GridFS file:", fileId, error);
    throw error;
  }
}

// Helper function to delete directory recursively
function deleteDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
    console.log("✅ Deleted directory:", dirPath);
  }
}

// LAUNCH BUILD ENDPOINT
router.post("/launch-build", async (req, res) => {
  try {
    const { projectId, buildId } = req.body;

    console.log("🚀 Launch build request received:", {
      projectId,
      buildId
    });

    if (!projectId) {
      return res.status(400).json({
        error: "Missing required field: projectId"
      });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({
        error: "Project not found"
      });
    }

    // Find the specific build to launch
    let build;
    if (buildId) {
      build = project.builds.id(buildId);
      if (!build) {
        return res.status(404).json({
          error: "Build not found"
        });
      }
    } else {
      // Launch main build if no buildId specified
      build = project.builds.find(b => b.isMain);
      if (!build) {
        return res.status(404).json({
          error: "No main build found for this project"
        });
      }
    }

    console.log("📁 Build data:", {
      name: build.name,
      description: build.description,
      executablePath: build.executablePath,
      isMain: build.isMain
    });

    const executableName = build.executablePath;
    if (!executableName) {
      return res.status(400).json({
        error: "No executable path configured for this build"
      });
    }

    // Build path structure
    const projectDir = path.join(
      UNITY_ROOT,
      build.category || project.category,
      project.name.replace(/\s+/g, "_")
    );

    const fullExecutablePath = path.join(projectDir, executableName);

    console.log("🔍 Path reconstruction:", {
      projectDir,
      executableName,
      fullExecutablePath
    });

    if (!fs.existsSync(fullExecutablePath)) {
      console.log("❌ Build file not found at path:", fullExecutablePath);

      if (fs.existsSync(projectDir)) {
        console.log("📁 Directory exists, contents:", fs.readdirSync(projectDir));

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
          const foundExe = allExeFiles[0];
          console.log("🔄 Using found executable:", foundExe);

          build.executablePath = foundExe.relative;
          await project.save();

          console.log("✅ Updated build with new executable path:", foundExe.relative);
          return launchExecutable(foundExe.path, res);
        }
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
        res.status(500).json({
          success: false,
          error: `Failed to launch: ${error.message}`
        });
      } else {
        console.log('✅ Build launched successfully');
        res.json({
          success: true,
          message: "Build launched successfully"
        });
      }
      resolve();
    });
  });
}





const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const exists = promisify(fs.exists);

// Temporary chunk storage (will be cleaned up)
const CHUNK_DIR = path.join(process.cwd(), "chunk_temp");

// Ensure chunk directory exists
(async () => {
  try {
    await mkdir(CHUNK_DIR, { recursive: true });
    console.log("✅ Chunk directory initialized");
  } catch (error) {
    console.error("❌ Failed to create chunk directory:", error);
  }
})();

// Clean up old chunks on startup
const cleanOldChunks = async () => {
  try {
    const files = await readdir(CHUNK_DIR);
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(CHUNK_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > ONE_HOUR) {
        await unlink(filePath);
        console.log(`🧹 Cleaned up old chunk: ${file}`);
      }
    }
  } catch (error) {
    console.error("Error cleaning old chunks:", error);
  }
};

// Run cleanup on startup
cleanOldChunks();

// Complete chunk upload handler
router.post('/upload/chunk', combinedUpload.single('chunk'), async (req, res) => {
  try {
    const { 
      chunkIndex, 
      totalChunks, 
      fileKey, 
      originalName, 
      fileSize,
      uploadId 
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: "No chunk file received" });
    }

    // Generate unique upload ID if not provided
    const currentUploadId = uploadId || `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create upload directory
    const uploadDir = path.join(CHUNK_DIR, currentUploadId);
    await mkdir(uploadDir, { recursive: true });

    // Save chunk with index
    const chunkFilename = `chunk_${chunkIndex}.part`;
    const chunkPath = path.join(uploadDir, chunkFilename);
    
    // Write chunk to disk
    await writeFile(chunkPath, req.file.buffer);
    
    console.log(`📦 Saved chunk ${parseInt(chunkIndex) + 1}/${totalChunks} for ${originalName}`);

    // Check if all chunks are uploaded
    const chunkFiles = await readdir(uploadDir);
    const allChunksUploaded = chunkFiles.length === parseInt(totalChunks);

    if (allChunksUploaded) {
      console.log(`✅ All chunks uploaded for ${originalName}, assembling...`);
      
      // Assemble file
      const assembledFilePath = path.join(uploadDir, originalName);
      const writeStream = fs.createWriteStream(assembledFilePath);

      // Read chunks in order and assemble
      for (let i = 0; i < parseInt(totalChunks); i++) {
        const chunkPath = path.join(uploadDir, `chunk_${i}.part`);
        const chunkBuffer = fs.readFileSync(chunkPath);
        writeStream.write(chunkBuffer);
        
        // Delete chunk file after writing
        await unlink(chunkPath);
      }

      writeStream.end();

      writeStream.on('finish', async () => {
        console.log(`✅ File assembled: ${originalName}`);
        
        // Store assembled file info for main request
        const assembledFileInfo = {
          originalName,
          filePath: assembledFilePath,
          fileKey,
          uploadId: currentUploadId,
          size: fileSize
        };

        // You can store this in a temporary in-memory store or database
        // For now, we'll just log it and the main route will handle it
        
        res.json({ 
          success: true, 
          message: "All chunks uploaded and file assembled",
          uploadId: currentUploadId,
          assembled: true
        });
      });

      writeStream.on('error', (error) => {
        console.error("❌ Error assembling file:", error);
        res.status(500).json({ error: "Failed to assemble file" });
      });

    } else {
      // More chunks remaining
      res.json({ 
        success: true, 
        message: `Chunk ${parseInt(chunkIndex) + 1}/${totalChunks} received`,
        chunkIndex: parseInt(chunkIndex),
        uploadId: currentUploadId
      });
    }

  } catch (error) {
    console.error('❌ Chunk upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to get uploaded file by uploadId
router.get('/upload/file/:uploadId', async (req, res) => {
  try {
    const { uploadId } = req.params;
    const uploadDir = path.join(CHUNK_DIR, uploadId);
    
    // Find the assembled file
    const files = await readdir(uploadDir);
    const assembledFile = files.find(f => !f.includes('chunk_'));
    
    if (!assembledFile) {
      return res.status(404).json({ error: "File not found or not fully assembled" });
    }

    const filePath = path.join(uploadDir, assembledFile);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
  } catch (error) {
    console.error('❌ Error retrieving uploaded file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cleanup endpoint (call this after successful project creation)
router.delete('/upload/cleanup/:uploadId', async (req, res) => {
  try {
    const { uploadId } = req.params;
    const uploadDir = path.join(CHUNK_DIR, uploadId);
    
    if (fs.existsSync(uploadDir)) {
      // Delete entire upload directory
      fs.rmSync(uploadDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up upload: ${uploadId}`);
    }
    
    res.json({ success: true, message: "Upload cleaned up" });
  } catch (error) {
    console.error('❌ Cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});
// GET ALL PROJECTS
router.get("/my-projects", async (req, res) => {
  try {
    console.log("📋 Fetching all projects for dashboard");

    const projects = await Project.find().populate("createdBy", "email role");
    console.log("Projects found:", projects.length);

    const mappedProjects = projects.map((p) => ({
      ...p.toObject(),
      modelFileId: p.modelFileId ? p.modelFileId.toString() : null,
      builds: p.builds.map(b => ({
        ...b.toObject(),
        _id: b._id.toString(),
        // Include name and description for all builds
        name: b.name,
        description: b.description
      })),
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


// Enhanced cleanup function
const cleanupChunkTemp = async () => {
  try {
    if (!fs.existsSync(CHUNK_DIR)) {
      return;
    }

    const files = await readdir(CHUNK_DIR);
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;

    let cleanedCount = 0;
    
    for (const file of files) {
      const filePath = path.join(CHUNK_DIR, file);
      const stats = fs.statSync(filePath);
      
      // Delete folders older than 1 hour
      if (now - stats.mtime.getTime() > ONE_HOUR) {
        fs.rmSync(filePath, { recursive: true, force: true });
        cleanedCount++;
        console.log(`🧹 Cleaned up old chunk folder: ${file}`);
      }
    }

    if (cleanedCount > 0) {
      console.log(`✅ Cleaned up ${cleanedCount} old chunk folders`);
    }

    // If chunk_temp directory is empty, delete it too
    const remainingFiles = await readdir(CHUNK_DIR);
    if (remainingFiles.length === 0) {
      fs.rmdirSync(CHUNK_DIR);
      console.log("🧹 Deleted empty chunk_temp directory");
    }

  } catch (error) {
    console.error("Error during chunk_temp cleanup:", error);
  }
};
// CREATE PROJECT (Admin only) - With enhanced build support
const processBuildZipStream = async (fileStream, originalname, category, projectName, buildConfig) => {
  return new Promise((resolve, reject) => {
    const projectFolder = path.join(
      UNITY_ROOT,
      category,
      projectName.replace(/\s+/g, "_")
    );

    // Create project folder if it doesn't exist
    if (!fs.existsSync(projectFolder)) {
      fs.mkdirSync(projectFolder, { recursive: true });
    }

    console.log("🔓 Extracting build from stream...");

    // Stream directly to extraction
    fileStream
      .pipe(unzipper.Extract({ path: projectFolder }))
      .on('close', () => {
        console.log("✅ Extraction completed");
        
        // Find .exe
        console.log("🔍 Searching for executable...");
        const exe = findExe(projectFolder);

        if (!exe) {
          console.log("❌ No executable found");
          reject(new Error("No .exe file found in the build."));
          return;
        }

        console.log("✅ Found executable:", exe);

        resolve({
          name: buildConfig.name || "Unnamed Build",
          description: buildConfig.description || "",
          executablePath: exe,
          isMain: buildConfig.isMain || false,
          category: category,
          version: buildConfig.version || "1.0.0"
        });
      })
      .on('error', (error) => {
        console.error("❌ Extraction error:", error);
        reject(error);
      });
  });
};
// Enhanced CREATE PROJECT route that handles chunked files
router.post(
  "/create",
  combinedUpload.fields([
    { name: "mainBuildZip", maxCount: 1 },
    { name: "subBuildZips", maxCount: 10 },
    { name: "modelFile", maxCount: 1 },
    { name: "subModelFiles", maxCount: 10 },
    { name: "chunkedFiles", maxCount: 20 }
  ]),
  async (req, res) => {
    try {
      console.log("📨 Starting project creation with chunk support...");

      // 🟢 ADD MEMORY USAGE LOGGING
      const used = process.memoryUsage();
      console.log("🧠 Memory usage on start:", {
        rss: `${Math.round(used.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(used.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(used.heapUsed / 1024 / 1024)} MB`,
      });

      const { 
        name, 
        description, 
        modelName, 
        subModels, 
        category, 
        mainBuild, 
        subBuilds,
        chunkedFiles
      } = req.body;

      // Parse configurations
      let parsedSubModels = [];
      if (subModels) {
        try { parsedSubModels = JSON.parse(subModels); } catch (e) { parsedSubModels = []; }
      }

      let parsedMainBuild = {};
      if (mainBuild) {
        try { parsedMainBuild = JSON.parse(mainBuild); } catch (e) {
          parsedMainBuild = { name: "Main Build", description: "Primary build for this project" };
        }
      }

      let parsedSubBuilds = [];
      if (subBuilds) {
        try { parsedSubBuilds = JSON.parse(subBuilds); } catch (e) { parsedSubBuilds = []; }
      }

      let parsedChunkedFiles = [];
      if (chunkedFiles) {
        try { parsedChunkedFiles = JSON.parse(chunkedFiles); } catch (e) { console.error("Error parsing chunkedFiles:", e); }
      }

      console.log("🔍 Processing chunked files:", parsedChunkedFiles.length);

      // 🟢 PROCESS CHUNKED FILES ONE BY ONE TO AVOID MEMORY OVERLOAD
      for (const chunkedFile of parsedChunkedFiles) {
        const { uploadId, fileKey, originalName } = chunkedFile;
        const uploadDir = path.join(CHUNK_DIR, uploadId);
        const assembledFilePath = path.join(uploadDir, originalName);

        console.log(`🔍 Processing chunked file: ${originalName} from ${uploadId}`);

        if (fs.existsSync(assembledFilePath)) {
          try {
            // 🟢 USE STREAMS INSTEAD OF LOADING ENTIRE FILE INTO MEMORY
            const fileStats = fs.statSync(assembledFilePath);
            console.log(`📁 File size: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);

            // Create a file stream instead of loading entire buffer
            const fileStream = fs.createReadStream(assembledFilePath);
            
            // Create file info with stream instead of buffer
            const fileInfo = {
              stream: fileStream,
              originalname: originalName,
              mimetype: 'application/octet-stream',
              size: fileStats.size
            };

            // Add to appropriate files array based on fileKey
            if (fileKey === 'mainBuildZip') {
              req.files.mainBuildZip = [fileInfo];
            } else if (fileKey.startsWith('subBuildZips_')) {
              if (!req.files.subBuildZips) req.files.subBuildZips = [];
              req.files.subBuildZips.push(fileInfo);
            }

            console.log(`✅ Added chunked file to request: ${originalName}`);

          } catch (error) {
            console.error(`❌ Error processing chunked file ${originalName}:`, error);
          }
        } else {
          console.error(`❌ Assembled file not found: ${assembledFilePath}`);
        }
      }

      // Initialize GridFS bucket
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: "fs",
      });

      // Handle main model file with streams
      let modelFileId = null;
      let modelFileName = "";
      let modelFileContentType = "";

      if (req.files.modelFile && req.files.modelFile[0]) {
        const modelFile = req.files.modelFile[0];
        console.log("📦 Processing main model file:", modelFile.originalname);

        try {
          const uploadStream = bucket.openUploadStream(modelFile.originalname, {
            contentType: modelFile.mimetype,
          });

          // 🟢 USE STREAMS FOR GRIDFS UPLOAD
          if (modelFile.stream) {
            // For chunked files, use the stream
            await new Promise((resolve, reject) => {
              modelFile.stream
                .pipe(uploadStream)
                .on('finish', () => {
                  modelFileId = uploadStream.id;
                  console.log("✅ Main model streamed to GridFS, ID:", modelFileId);
                  resolve();
                })
                .on('error', reject);
            });
          } else {
            // For direct uploads, use buffer with stream
            const bufferStream = new stream.PassThrough();
            bufferStream.end(modelFile.buffer);
            
            await new Promise((resolve, reject) => {
              bufferStream
                .pipe(uploadStream)
                .on('finish', () => {
                  modelFileId = uploadStream.id;
                  console.log("✅ Main model uploaded to GridFS, ID:", modelFileId);
                  resolve();
                })
                .on('error', reject);
            });
          }

          modelFileName = modelFile.originalname;
          modelFileContentType = modelFile.mimetype;

        } catch (error) {
          console.error("❌ Error processing main model file:", error);
          return res.status(500).json({ error: "Failed to process main model file" });
        }
      } else {
        return res.status(400).json({
          error: "Main model file is required for all project categories"
        });
      }

      // Process builds with streams
      const projectBuilds = [];

      // Process main build
      if (req.files.mainBuildZip && req.files.mainBuildZip[0]) {
        const mainBuildFile = req.files.mainBuildZip[0];
        const mainBuildConfig = {
          name: parsedMainBuild.name || "Main Build",
          description: parsedMainBuild.description || "Primary build for this project",
          isMain: true,
          version: parsedMainBuild.version || "1.0.0"
        };

        console.log("🔓 Processing main build...");

        try {
          const mainBuild = await processBuildZipStream(
            mainBuildFile.stream || new stream.PassThrough().end(mainBuildFile.buffer),
            mainBuildFile.originalname,
            category,
            name,
            mainBuildConfig
          );
          projectBuilds.push(mainBuild);
          console.log("✅ Main build processed");
        } catch (error) {
          console.error("❌ Error processing main build:", error);
          return res.status(500).json({ error: "Failed to process main build: " + error.message });
        }
      } else {
        return res.status(400).json({
          error: "Main build zip file is required"
        });
      }

      // Process sub-builds
      if (req.files.subBuildZips && req.files.subBuildZips.length > 0) {
        console.log("📦 Processing sub-builds...");

        for (let i = 0; i < req.files.subBuildZips.length; i++) {
          const buildZip = req.files.subBuildZips[i];
          const buildConfig = parsedSubBuilds[i] || {
            name: `Sub Build ${i + 1}`,
            description: `Additional build variant ${i + 1}`,
            isMain: false
          };

          try {
            const subBuild = await processBuildZipStream(
              buildZip.stream || new stream.PassThrough().end(buildZip.buffer),
              buildZip.originalname,
              category,
              name,
              buildConfig
            );
            projectBuilds.push(subBuild);
            console.log("✅ Sub-build processed:", subBuild.name);
          } catch (error) {
            console.error(`❌ Error processing sub-build ${i}:`, error);
            // Continue with other builds
          }
        }
      }

      // Create the project
      const project = new Project({
        name,
        description,
        modelName,
        modelFileId,
        modelFileName,
        category,
        builds: projectBuilds,
        modelFileContentType,
        subModels: parsedSubModels,
        createdBy: req.user?.id || new mongoose.Types.ObjectId(),
      });

      await project.save();
      console.log("✅ Project saved successfully with ID:", project._id);

      // 🟢 CLEANUP CHUNKED FILES AFTER SUCCESS
      for (const chunkedFile of parsedChunkedFiles) {
        try {
          const uploadDir = path.join(CHUNK_DIR, chunkedFile.uploadId);
          if (fs.existsSync(uploadDir)) {
            fs.rmSync(uploadDir, { recursive: true, force: true });
            console.log(`🧹 Cleaned up chunked upload: ${chunkedFile.uploadId}`);
          }
        } catch (cleanupError) {
          console.error("Error cleaning up chunked files:", cleanupError);
        }
      }

      // 🟢 LOG MEMORY USAGE AFTER PROCESSING
      const usedAfter = process.memoryUsage();
      console.log("🧠 Memory usage after processing:", {
        rss: `${Math.round(usedAfter.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(usedAfter.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(usedAfter.heapUsed / 1024 / 1024)} MB`,
      });

      res.status(201).json({
        message: "Project created successfully with chunked uploads",
        project: {
          ...project.toObject(),
          builds: project.builds.map(b => ({
            _id: b._id.toString(),
            name: b.name,
            description: b.description,
            isMain: b.isMain,
            executablePath: b.executablePath,
            version: b.version
          }))
        }
      });

    } catch (err) {
      console.error("❌ Error creating project:", err);
      
      // 🟢 LOG MEMORY USAGE ON ERROR
      const usedError = process.memoryUsage();
      console.log("💥 Memory usage on error:", {
        rss: `${Math.round(usedError.rss / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(usedError.heapTotal / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(usedError.heapUsed / 1024 / 1024)} MB`,
      });

      // Cleanup on error
      try {
        const { chunkedFiles } = req.body;
        if (chunkedFiles) {
          const parsedChunkedFiles = JSON.parse(chunkedFiles);
          for (const chunkedFile of parsedChunkedFiles) {
            const uploadDir = path.join(CHUNK_DIR, chunkedFile.uploadId);
            if (fs.existsSync(uploadDir)) {
              fs.rmSync(uploadDir, { recursive: true, force: true });
            }
          }
        }
      } catch (cleanupError) {
        console.error("Error during cleanup:", cleanupError);
      }
      
      res.status(500).json({ error: err.message });
    }
  }
);

// Add this route to handle chunked uploads

// ADD NEW BUILD TO EXISTING PROJECT
router.post(
  "/:id/builds",
  combinedUpload.fields([{ name: "buildZip", maxCount: 1 }]),
  async (req, res) => {
    try {
      const projectId = req.params.id;
      const { name, description, version, isMain } = req.body;

      if (!req.files.buildZip || !req.files.buildZip[0]) {
        return res.status(400).json({ error: "Build zip file is required" });
      }

      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      // If setting this as main build, unset previous main build
      if (isMain === 'true' || isMain === true) {
        project.builds.forEach(build => {
          build.isMain = false;
        });
      }

      const buildConfig = {
        name: name || `Build ${project.builds.length + 1}`,
        description: description || "",
        version: version || "1.0.0",
        isMain: isMain === 'true' || isMain === true
      };

      const newBuild = await processBuildZip(
        req.files.buildZip[0],
        project.category,
        project.name,
        buildConfig
      );

      project.builds.push(newBuild);
      await project.save();

      console.log("✅ New build added:", {
        name: newBuild.name,
        description: newBuild.description,
        isMain: newBuild.isMain
      });

      res.status(201).json({
        message: "Build added successfully",
        build: newBuild
      });

    } catch (error) {
      console.error("❌ Error adding build:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// UPDATE BUILD
router.put(
  "/:projectId/builds/:buildId",
  async (req, res) => {
    try {
      const { projectId, buildId } = req.params;
      const { name, description, version, isMain } = req.body;

      const project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ error: "Project not found" });
      }

      const build = project.builds.id(buildId);
      if (!build) {
        return res.status(404).json({ error: "Build not found" });
      }

      // If setting this as main build, unset previous main build
      if (isMain === 'true' || isMain === true) {
        project.builds.forEach(b => {
          if (b._id.toString() !== buildId) {
            b.isMain = false;
          }
        });
      }

      // Update build details
      build.name = name || build.name;
      build.description = description !== undefined ? description : build.description;
      build.version = version || build.version;
      build.isMain = isMain === 'true' || isMain === true || build.isMain;

      await project.save();

      console.log("✅ Build updated:", {
        name: build.name,
        description: build.description,
        isMain: build.isMain
      });

      res.json({
        message: "Build updated successfully",
        build: {
          _id: build._id,
          name: build.name,
          description: build.description,
          isMain: build.isMain,
          version: build.version,
          executablePath: build.executablePath
        }
      });

    } catch (error) {
      console.error("❌ Error updating build:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// GET PROJECT BUILDS WITH DETAILS
router.get("/:id/builds", async (req, res) => {
  try {
    const projectId = req.params.id;

    const project = await Project.findById(projectId).select("builds name category");
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const buildsWithDetails = project.builds.map(build => ({
      _id: build._id,
      name: build.name,
      description: build.description,
      isMain: build.isMain,
      executablePath: build.executablePath,
      version: build.version,
      category: build.category,
      createdAt: build.createdAt
    }));

    res.json({
      projectName: project.name,
      projectCategory: project.category,
      builds: buildsWithDetails
    });

  } catch (error) {
    console.error("❌ Error fetching builds:", error);
    res.status(500).json({ error: error.message });
  }
});

// GET SPECIFIC BUILD DETAILS
router.get("/:projectId/builds/:buildId", async (req, res) => {
  try {
    const { projectId, buildId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const build = project.builds.id(buildId);
    if (!build) {
      return res.status(404).json({ error: "Build not found" });
    }

    res.json({
      build: {
        _id: build._id,
        name: build.name,
        description: build.description,
        isMain: build.isMain,
        executablePath: build.executablePath,
        version: build.version,
        category: build.category,
        createdAt: build.createdAt
      },
      project: {
        name: project.name,
        category: project.category
      }
    });

  } catch (error) {
    console.error("❌ Error fetching build details:", error);
    res.status(500).json({ error: error.message });
  }
});
// GET FILE STREAM - Add this route to your backend
router.get("/file/:id", async (req, res) => {
  try {
    const fileId = req.params.id;
    if (!fileId || fileId === "undefined") {
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

    // Set correct MIME types for 3D models
    if (ext === "glb") contentType = "model/gltf-binary";
    else if (ext === "gltf") contentType = "model/gltf+json";
    else if (ext === "fbx") contentType = "application/octet-stream";
    else if (!contentType) contentType = "application/octet-stream";

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");

    if (req.query.download === "true") {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filesCollection.filename}"`
      );
    }

    const range = req.headers.range;
    const fileLength = filesCollection.length;

    if (!range) {
      res.status(200);
      res.setHeader("Content-Length", filesCollection.length);
      const stream = bucket.openDownloadStream(_id);
      stream.on("error", (err) => {
        console.error("Stream error:", err);
        res.status(500).end();
      });
      stream.pipe(res);
      return;
    }

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


// UPDATE PROJECT (Admin only)
router.put(
  "/:id",
  authMiddleware,
  adminMiddleware,
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

      await existingProject.save();
      res.json({ message: "Project updated successfully", project: existingProject });
    } catch (err) {
      console.error("Error updating project:", err);
      res.status(500).json({ error: err.message });
    }
  }
);


// DELETE PROJECT (Admin only) - WITH COMPLETE CLEANUP
router.delete("/:id",async (req, res) => {
  try {
    const projectId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(projectId))
      return res.status(400).json({ error: "Invalid project ID" });

    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    console.log("🗑️ Starting project deletion cleanup for:", project.name);

    // Initialize GridFS bucket for file cleanup
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: "fs",
    });

    // 1. Delete main model file from GridFS
    if (project.modelFileId) {
      try {
        await bucket.delete(project.modelFileId);
        console.log("✅ Deleted main model file from GridFS:", project.modelFileId);
      } catch (error) {
        console.error("❌ Error deleting main model file:", error);
      }
    }

    // 2. Delete submodel files from GridFS
    if (project.subModels && project.subModels.length > 0) {
      for (const subModel of project.subModels) {
        if (subModel.fileId) {
          try {
            await bucket.delete(subModel.fileId);
            console.log("✅ Deleted submodel file from GridFS:", subModel.fileId);
          } catch (error) {
            console.error("❌ Error deleting submodel file:", error);
          }
        }
      }
    }

    // 3. Delete build files from file system
    if (project.builds && project.builds.length > 0) {
      for (const build of project.builds) {
        try {
          const projectDir = path.join(
            UNITY_ROOT,
            build.category || project.category,
            project.name.replace(/\s+/g, "_")
          );

          if (fs.existsSync(projectDir)) {
            // Delete the entire project directory
            fs.rmSync(projectDir, { recursive: true, force: true });
            console.log("✅ Deleted build directory:", projectDir);
          }
        } catch (error) {
          console.error("❌ Error deleting build directory:", error);
        }
      }
    }

    // 4. Delete any temporary files related to this project
    try {
      const tempDir = path.join(UNITY_ROOT, 'temp');
      if (fs.existsSync(tempDir)) {
        // Look for files that might be related to this project
        const files = fs.readdirSync(tempDir);
        const projectPattern = new RegExp(project.name.replace(/\s+/g, '_'), 'i');

        for (const file of files) {
          if (projectPattern.test(file)) {
            const filePath = path.join(tempDir, file);
            fs.unlinkSync(filePath);
            console.log("✅ Deleted temporary file:", filePath);
          }
        }
      }
    } catch (error) {
      console.error("❌ Error cleaning temporary files:", error);
    }

    // 5. Finally delete the project from database
    await Project.deleteOne({ _id: projectId });

    console.log("✅ Project deletion completed successfully");

    res.json({
      message: "Project and all associated files deleted successfully",
      deletedProject: {
        name: project.name,
        id: projectId
      }
    });

  } catch (err) {
    console.error("❌ Error deleting project:", err);
    res.status(500).json({ error: err.message });
  }
});



// GET SINGLE PROJECT
router.get("/:id", async (req, res) => {
  try {
    const projectId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(projectId))
      return res.status(400).json({ error: "Invalid project ID" });

    const project = await Project.findById(projectId)
      .populate("createdBy", "email role");

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
      .populate("createdBy", "name email role")
      .sort({ createdAt: -1 });

    res.json(projects);
  } catch (err) {
    console.error("Error fetching projects:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;