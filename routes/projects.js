import express from "express";
import mongoose from "mongoose";
import Project from "../models/Project.js";
import { authMiddleware, adminMiddleware } from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import combinedUpload from "../middleware/unityMulterConfig.js";
import unzipper from "unzipper";
import { exec } from 'child_process';
import fs from "fs";
import path from "path";
import { promisify } from "util";
import stream from "stream";
import multer from "multer";

const router = express.Router();

const chunkStorage = multer.memoryStorage();

const chunkUpload = multer({
  storage: chunkStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, 
  },
})


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


async function deleteGridFSFile(fileId, bucket) {
  try {
    if (!fileId) return;


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


// router.post("/launch-build", async (req, res) => {
//   try {
//     const { projectId, buildId } = req.body;

//     console.log("🚀 Launch build request received:", {
//       projectId,
//       buildId
//     });

//     if (!projectId) {
//       return res.status(400).json({
//         error: "Missing required field: projectId"
//       });
//     }

//     const project = await Project.findById(projectId);
//     if (!project) {
//       return res.status(404).json({
//         error: "Project not found"
//       });
//     }

//     // Find the specific build to launch
//     let build;
//     if (buildId) {
//       build = project.builds.id(buildId);
//       if (!build) {
//         return res.status(404).json({
//           error: "Build not found"
//         });
//       }
//     } else {
//       // Launch main build if no buildId specified
//       build = project.builds.find(b => b.isMain);
//       if (!build) {
//         return res.status(404).json({
//           error: "No main build found for this project"
//         });
//       }
//     }

//     console.log("📁 Build data:", {
//       name: build.name,
//       description: build.description,
//       executablePath: build.executablePath,
//       isMain: build.isMain
//     });

//     const executableName = build.executablePath;
//     if (!executableName) {
//       return res.status(400).json({
//         error: "No executable path configured for this build"
//       });
//     }

//     // Build path structure
//     const projectDir = path.join(
//       UNITY_ROOT,
//       build.category || project.category,
//       project.name.replace(/\s+/g, "_")
//     );

//     const fullExecutablePath = path.join(projectDir, executableName);

//     console.log("🔍 Path reconstruction:", {
//       projectDir,
//       executableName,
//       fullExecutablePath
//     });

//     if (!fs.existsSync(fullExecutablePath)) {
//       console.log("❌ Build file not found at path:", fullExecutablePath);

//       if (fs.existsSync(projectDir)) {
//         console.log("📁 Directory exists, contents:", fs.readdirSync(projectDir));

//         const allExeFiles = [];
//         function findExeFiles(dir) {
//           const items = fs.readdirSync(dir);
//           items.forEach(item => {
//             const fullPath = path.join(dir, item);
//             if (fs.statSync(fullPath).isDirectory()) {
//               findExeFiles(fullPath);
//             } else if (item.endsWith('.exe')) {
//               allExeFiles.push({
//                 name: item,
//                 path: fullPath,
//                 relative: path.relative(projectDir, fullPath)
//               });
//             }
//           });
//         }

//         findExeFiles(projectDir);
//         console.log("🔍 All .exe files found:", allExeFiles);

//         if (allExeFiles.length > 0) {
//           const foundExe = allExeFiles[0];
//           console.log("🔄 Using found executable:", foundExe);

//           build.executablePath = foundExe.relative;
//           await project.save();

//           console.log("✅ Updated build with new executable path:", foundExe.relative);
//           return launchExecutable(foundExe.path, res);
//         }
//       }

//       return res.status(404).json({
//         error: "Build file not found. It may have been moved or deleted."
//       });
//     }

//     console.log("✅ Build file found, launching:", fullExecutablePath);
//     await launchExecutable(fullExecutablePath, res);

//   } catch (error) {
//     console.error("❌ Error in launch-build:", error);
//     res.status(500).json({
//       error: "Internal server error: " + error.message
//     });
//   }
// });

router.post("/launch-build", async (req, res) => {
  try {
    const { projectId, buildId } = req.body;

    console.log("🚀 Launch build request received:", { projectId, buildId });

    if (!projectId) {
      return res.status(400).json({ error: "Missing required field: projectId" });
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

 
    let build;
    if (buildId) {
      build = project.builds.id(buildId);
      if (!build) {
        return res.status(404).json({ error: "Build not found" });
      }
    } else {
    
      build = project.builds.find(b => b.isMain);
      if (!build) {
        return res.status(404).json({ error: "No main build found for this project" });
      }
    }

    console.log("📁 Build data:", {
      name: build.name,
      executablePath: build.executablePath
    });

   
    const buildsRoot = path.join(CHUNK_DIR, 'builds');
    const fullExecutablePath = path.join(buildsRoot, build.executablePath);

    console.log("🔍 Executable path:", fullExecutablePath);

    if (!fs.existsSync(fullExecutablePath)) {
      console.log("❌ Build file not found at path:", fullExecutablePath);
      

      const buildDir = path.dirname(fullExecutablePath);
      if (fs.existsSync(buildDir)) {
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
                relative: path.relative(buildsRoot, fullPath)
              });
            }
          });
        }

        findExeFiles(buildDir);
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
        error: "Build file not found. It may have expired or been cleaned up."
      });
    }

    console.log("✅ Build file found, launching:", fullExecutablePath);
    await launchExecutable(fullExecutablePath, res);

  } catch (error) {
    console.error("❌ Error in launch-build:", error);
    res.status(500).json({ error: "Internal server error: " + error.message });
  }
});

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


const CHUNK_DIR = path.join(process.cwd(), "chunk_temp");


(async () => {
  try {
    await mkdir(CHUNK_DIR, { recursive: true });
    console.log("✅ Chunk directory initialized");
  } catch (error) {
    console.error("❌ Failed to create chunk directory:", error);
  }
})();


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


cleanOldChunks();


async function isBuildDirectory(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return false;
    
    const items = await readdir(dirPath);
    
  
    const buildIndicators = ['.exe', '.dll', 'UnityPlayer.dll', 'MonoBleedingEdge', '_Data'];
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
    
        if (await isBuildDirectory(itemPath)) return true;
      } else {
      
        for (const indicator of buildIndicators) {
          if (item.includes(indicator) || item.endsWith(indicator)) {
            return true;
          }
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error(`Error checking build directory ${dirPath}:`, error);
    return false;
  }
}


const cleanupTempStorage = async () => {
  try {
    if (!fs.existsSync(CHUNK_DIR)) {
      return;
    }

    const items = await readdir(CHUNK_DIR);
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;

    let cleanedCount = 0;
    
    for (const item of items) {
      const itemPath = path.join(CHUNK_DIR, item);
      
      try {
        const stats = fs.statSync(itemPath);
        
     
        if (now - stats.mtime.getTime() > ONE_HOUR) {
          fs.rmSync(itemPath, { recursive: true, force: true });
          cleanedCount++;
          console.log(`🧹 Cleaned up old temporary item: ${item}`);
        }
      } catch (error) {
        console.error(`❌ Failed to clean ${item}:`, error.message);
      }
    }

    if (cleanedCount > 0) {
      console.log(`✅ Cleaned up ${cleanedCount} temporary items`);
    }

  } catch (error) {
    console.error("Error during temp storage cleanup:", error);
  }
};


setInterval(cleanupTempStorage, 30 * 60 * 1000); 


const cleanupAccidentalChunkFiles = async () => {
  try {
    console.log("🧹 Cleaning up accidental chunk files in Unity builds directory...");
    
    const cleanDirectory = async (dirPath) => {
      if (!fs.existsSync(dirPath)) return;
      
      const items = await readdir(dirPath);
      for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
         
          await cleanDirectory(fullPath);
          
      
          const remainingItems = await readdir(fullPath);
          if (remainingItems.length === 0) {
            fs.rmdirSync(fullPath);
            console.log(`✅ Removed empty directory: ${fullPath}`);
          }
        } else if (item.includes('chunk_') || item.endsWith('.part')) {
        
          fs.unlinkSync(fullPath);
          console.log(`✅ Removed chunk file: ${fullPath}`);
        }
      }
    };
    
    await cleanDirectory(UNITY_ROOT);
    console.log("✅ Finished cleaning accidental chunk files");
  } catch (error) {
    console.error("❌ Error cleaning accidental chunk files:", error);
  }
};


cleanupAccidentalChunkFiles();


router.post('/upload/chunk', chunkUpload.single('chunk'), async (req, res) => {
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
    
    // Create upload directory in CHUNK_DIR (temporary location)
    const uploadDir = path.join(CHUNK_DIR, currentUploadId);
    await mkdir(uploadDir, { recursive: true });

    // Save chunk with index to TEMPORARY location
    const chunkFilename = `chunk_${chunkIndex}.part`;
    const chunkPath = path.join(uploadDir, chunkFilename);
    
    // Write chunk to TEMPORARY disk location (CHUNK_DIR)
    await writeFile(chunkPath, req.file.buffer);
    
    console.log(`📦 Saved chunk ${parseInt(chunkIndex) + 1}/${totalChunks} for ${originalName} to TEMP location: ${chunkPath}`);

    // Check if all chunks are uploaded
    const chunkFiles = await readdir(uploadDir);
    const allChunksUploaded = chunkFiles.length === parseInt(totalChunks);

    if (allChunksUploaded) {
      console.log(`✅ All chunks uploaded for ${originalName}, assembling...`);
      
      // Assemble file in TEMPORARY location
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
        console.log(`✅ File assembled in TEMP location: ${assembledFilePath}`);
        
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





const processBuildZipStream = async (fileStream, originalname, category, projectName, buildConfig) => {
  return new Promise((resolve, reject) => {
 
    const tempProjectDir = path.join(
      CHUNK_DIR, 
      'builds',
      category,
      projectName.replace(/\s+/g, "_"),
      buildConfig.name.replace(/\s+/g, "_")
    );

   
    if (!fs.existsSync(tempProjectDir)) {
      fs.mkdirSync(tempProjectDir, { recursive: true });
      
    }

 
    fileStream
      .pipe(unzipper.Extract({ path: tempProjectDir }))
      .on('close', () => {
        const exe = findExe(tempProjectDir);

        if (!exe) {
          const extractedFiles = fs.readdirSync(tempProjectDir);
          reject(new Error("No .exe file found in the build."));
          return;
        }



        // 🟢 FIXED: Store relative path from temp builds directory
        const buildsRoot = path.join(CHUNK_DIR, 'builds');
        const relativeExePath = path.relative(buildsRoot, path.join(tempProjectDir, exe));

        resolve({
          name: buildConfig.name || "Unnamed Build",
          description: buildConfig.description || "",
          executablePath: relativeExePath, // Store relative path
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
    let parsedChunkedFiles = [];
    
    try {
      
      const used = process.memoryUsage();
      

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

      parsedChunkedFiles = [];
      if (chunkedFiles) {
        try { parsedChunkedFiles = JSON.parse(chunkedFiles); } catch (e) { console.error("Error parsing chunkedFiles:", e); }
      }

      for (const chunkedFile of parsedChunkedFiles) {
        const { uploadId, fileKey, originalName } = chunkedFile;
        const uploadDir = path.join(CHUNK_DIR, uploadId);
        const assembledFilePath = path.join(uploadDir, originalName);

       

        if (fs.existsSync(assembledFilePath)) {
          try {
          
            const fileStats = fs.statSync(assembledFilePath);
           
            
            const fileStream = fs.createReadStream(assembledFilePath);
            
            
            const fileInfo = {
              stream: fileStream,
              originalname: originalName,
              mimetype: 'application/octet-stream',
              size: fileStats.size
            };

            
            if (fileKey === 'mainBuildZip') {
              req.files.mainBuildZip = [fileInfo];
            } else if (fileKey.startsWith('subBuildZips_')) {
              if (!req.files.subBuildZips) req.files.subBuildZips = [];
              req.files.subBuildZips.push(fileInfo);
            }

          

          } catch (error) {
            console.error(`❌ Error processing chunked file ${originalName}:`, error);
          }
        } else {
          console.error(`❌ Assembled file not found: ${assembledFilePath}`);
        }
      }

    
      const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
        bucketName: "fs",
      });

      
      let modelFileId = null;
      let modelFileName = "";
      let modelFileContentType = "";

      if (req.files.modelFile && req.files.modelFile[0]) {
        const modelFile = req.files.modelFile[0];
      

        try {
          const uploadStream = bucket.openUploadStream(modelFile.originalname, {
            contentType: modelFile.mimetype,
          });

        
          if (modelFile.stream) {
            
            await new Promise((resolve, reject) => {
              modelFile.stream
                .pipe(uploadStream)
                .on('finish', () => {
                  modelFileId = uploadStream.id;
                 
                  resolve();
                })
                .on('error', reject);
            });
          } else {
           
            const bufferStream = new stream.PassThrough();
            bufferStream.end(modelFile.buffer);
            
            await new Promise((resolve, reject) => {
              bufferStream
                .pipe(uploadStream)
                .on('finish', () => {
                  modelFileId = uploadStream.id;
                  
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

 
      const projectBuilds = [];


      if (req.files.mainBuildZip && req.files.mainBuildZip[0]) {
        const mainBuildFile = req.files.mainBuildZip[0];
        const mainBuildConfig = {
          name: parsedMainBuild.name || "Main Build",
          description: parsedMainBuild.description || "Primary build for this project",
          isMain: true,
          version: parsedMainBuild.version || "1.0.0"
        };



        try {
          const mainBuild = await processBuildZipStream(
            mainBuildFile.stream || new stream.PassThrough().end(mainBuildFile.buffer),
            mainBuildFile.originalname,
            category,
            name,
            mainBuildConfig
          );
          projectBuilds.push(mainBuild);
       
        } catch (error) {
          console.error("❌ Error processing main build:", error);
          return res.status(500).json({ error: "Failed to process main build: " + error.message });
        }
      } else {
        return res.status(400).json({
          error: "Main build zip file is required"
        });
      }


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

      // 🟢 ENHANCED CLEANUP - Remove ALL temporary files
      console.log("🧹 Starting comprehensive cleanup...");

      if (parsedChunkedFiles && parsedChunkedFiles.length > 0) {
        let cleanedCount = 0;
        
        for (const chunkedFile of parsedChunkedFiles) {
          try {
            const uploadDir = path.join(CHUNK_DIR, chunkedFile.uploadId);
            
            if (fs.existsSync(uploadDir)) {
              fs.rmSync(uploadDir, { recursive: true, force: true });
              cleanedCount++;
              console.log(`✅ Cleaned up chunked upload: ${chunkedFile.uploadId}`);
            }
          } catch (cleanupError) {
            console.error(`⚠️ Could not clean up ${chunkedFile.uploadId}:`, cleanupError.message);
          }
        }
        
        console.log(`🧹 Cleaned up ${cleanedCount} chunk folders`);
      }

      // 🟢 Clean up any old temporary files
      await cleanupTempStorage();

      // 🟢 Final verification
      try {
        if (fs.existsSync(CHUNK_DIR)) {
          const remainingItems = await readdir(CHUNK_DIR);
          console.log(`📊 Final chunk_temp status: ${remainingItems.length} items remaining`);
          
          // List what remains for debugging
          if (remainingItems.length > 0) {
            console.log("📁 Remaining items:", remainingItems);
            
            // 🟢 Extra cleanup for any remaining build directories
            for (const item of remainingItems) {
              const itemPath = path.join(CHUNK_DIR, item);
              if (fs.existsSync(itemPath)) {
                try {
                  // Check if it's a build directory (contains 'builds' in path)
                  if (item.includes('build') || await isBuildDirectory(itemPath)) {
                    fs.rmSync(itemPath, { recursive: true, force: true });
                    console.log(`🧹 Cleaned up build directory: ${item}`);
                  }
                } catch (error) {
                  console.error(`❌ Could not clean ${item}:`, error.message);
                }
              }
            }
          }
        }
      } catch (verifyError) {
        console.error("❌ Final verification error:", verifyError);
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

      // 🟢 ENHANCED CLEANUP ON ERROR
      console.log("🧹 Starting cleanup due to error...");
      try {
        if (parsedChunkedFiles && parsedChunkedFiles.length > 0) {
          let cleanedCount = 0;
          for (const chunkedFile of parsedChunkedFiles) {
            try {
              const uploadDir = path.join(CHUNK_DIR, chunkedFile.uploadId);
              if (fs.existsSync(uploadDir)) {
                fs.rmSync(uploadDir, { recursive: true, force: true });
                cleanedCount++;
                console.log(`✅ Cleaned up chunked upload on error: ${chunkedFile.uploadId}`);
              }
            } catch (cleanupError) {
              console.error(`⚠️ Error cleaning up ${chunkedFile.uploadId} on error:`, cleanupError);
            }
          }
          console.log(`🧹 Error cleanup completed: ${cleanedCount} chunk folders removed`);
        }
        
        // Also clean up any temporary build directories
        await cleanupTempStorage();
        
      } catch (cleanupError) {
        console.error("❌ Error during error cleanup:", cleanupError);
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



router.delete("/:id", async (req, res) => {
  try {
    const projectId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(projectId))
      return res.status(400).json({ error: "Invalid project ID" });

    const project = await Project.findById(projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    console.log("🗑️ Starting project deletion cleanup for:", project.name);

    
    const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
      bucketName: "fs",
    });

    
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

    // 🟢 3. Delete temporary build files
    if (project.builds && project.builds.length > 0) {
      for (const build of project.builds) {
        try {
          const buildPath = path.join(CHUNK_DIR, 'builds', build.category, project.name.replace(/\s+/g, "_"), build.name.replace(/\s+/g, "_"));
          if (fs.existsSync(buildPath)) {
            fs.rmSync(buildPath, { recursive: true, force: true });
            console.log("✅ Deleted temporary build:", buildPath);
          }
        } catch (error) {
          console.error("❌ Error deleting temporary build:", error);
        }
      }
    }

    // 4. Finally delete the project from database
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
// Debug endpoint to check current chunk status
router.get('/debug/chunk-status', async (req, res) => {
  try {
    const status = {
      chunkDirExists: fs.existsSync(CHUNK_DIR),
      chunkDirPath: CHUNK_DIR,
      items: []
    };

    if (status.chunkDirExists) {
      status.items = await readdir(CHUNK_DIR);
      
      // Get details for each item
      status.details = [];
      for (const item of status.items) {
        const itemPath = path.join(CHUNK_DIR, item);
        try {
          const stats = fs.statSync(itemPath);
          status.details.push({
            name: item,
            isDirectory: stats.isDirectory(),
            size: stats.size,
            modified: stats.mtime,
            path: itemPath
          });
        } catch (error) {
          status.details.push({
            name: item,
            error: error.message
          });
        }
      }
    }

    console.log("🔍 Current chunk status:", JSON.stringify(status, null, 2));
    res.json(status);
  } catch (error) {
    console.error("❌ Chunk status error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to check Unity builds directory structure
router.get('/debug/builds-structure', async (req, res) => {
  try {
    const scanDirectory = (dir, depth = 0) => {
      const result = {
        name: path.basename(dir),
        path: dir,
        isDirectory: true,
        items: []
      };

      if (depth > 5) return result; // Prevent infinite recursion

      try {
        const items = fs.readdirSync(dir);
        
        for (const item of items) {
          const itemPath = path.join(dir, item);
          try {
            const stats = fs.statSync(itemPath);
            
            if (stats.isDirectory()) {
              result.items.push(scanDirectory(itemPath, depth + 1));
            } else {
              result.items.push({
                name: item,
                path: itemPath,
                isDirectory: false,
                size: stats.size,
                isExe: item.endsWith('.exe')
              });
            }
          } catch (error) {
            result.items.push({
              name: item,
              error: error.message
            });
          }
        }
      } catch (error) {
        result.error = error.message;
      }

      return result;
    };

    const structure = scanDirectory(UNITY_ROOT);
    console.log("🏗️ Unity builds structure:", JSON.stringify(structure, null, 2));
    res.json(structure);
  } catch (error) {
    console.error("❌ Builds structure error:", error);
    res.status(500).json({ error: error.message });
  }
});
export default router;