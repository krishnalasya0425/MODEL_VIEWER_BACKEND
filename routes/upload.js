import express from "express";
import combinedUpload from "../middleware/unityMulterConfig.js";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const router = express.Router();
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);

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

// Complete chunk upload handler
router.post('/chunk', combinedUpload.single('chunk'), async (req, res) => {
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

// Cleanup endpoint
router.delete('/cleanup/:uploadId', async (req, res) => {
  try {
    const { uploadId } = req.params;
    const uploadDir = path.join(CHUNK_DIR, uploadId);
    
    if (fs.existsSync(uploadDir)) {
      fs.rmSync(uploadDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up upload: ${uploadId}`);
    }
    
    res.json({ success: true, message: "Upload cleaned up" });
  } catch (error) {
    console.error('❌ Cleanup error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;