import express from "express";
import mongoose from "mongoose";
import HelpRequest from "../models/HelpRequest.js";
import Notification from "../models/Notification.js";
import upload from "../middleware/helpUpload.js";

const router = express.Router();

// ---------------------------
// Create Help Request (uploads to GridFS)
// ---------------------------
router.post("/create", upload.array("attachments"), async (req, res) => {
  try {
    const { projectId, userId, to, from, subject, message } = req.body;
    const attachments = req.files.map(f => ({
      filename: f.filename,
      fileId: f.id,
      contentType: f.contentType,
    }));

    const help = new HelpRequest({
      projectId,
      userId,
      to,
      from,
      subject,
      message,
      attachments,
    });

    await help.save();
    res.status(201).json({ success: true, help });
  } catch (err) {
    console.error("Error creating help:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------
// Get All Help Requests
// ---------------------------
router.get("/all", async (req, res) => {
  try {
    const helps = await HelpRequest.find().populate("userId projectId");
    res.json(helps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------
// Get Help Requests for a User
// ---------------------------
router.get("/user/:userId", async (req, res) => {
  try {
    const helps = await HelpRequest.find({ userId: req.params.userId }).populate("projectId");
    res.json(helps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ---------------------------
// Fetch / Stream a file from GridFS
// ---------------------------
router.get("/file/:id", async (req, res) => {
  try {
    const gfs = req.app.get("gfs");
    if (!gfs) {
      return res.status(500).json({ message: "GridFS not initialized" });
    }

    const fileId = new mongoose.Types.ObjectId(req.params.id);
    const files = await gfs.find({ _id: fileId }).toArray();
    if (!files || files.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    const file = files[0];
    const contentType = file.contentType || "application/octet-stream";

    // ✅ Set headers for browser rendering
    res.set({
      "Content-Type": contentType,
      "Content-Disposition":
        contentType.startsWith("image/")
          ? `inline; filename="${file.filename}"`
          : `attachment; filename="${file.filename}"`,
      "Cache-Control": "public, max-age=31536000",
    });

    // ✅ Stream the file
    const downloadStream = gfs.openDownloadStream(fileId);
    downloadStream.on("error", (err) => {
      console.error("Stream error:", err);
      res.status(500).json({ message: "Error streaming file" });
    });

    downloadStream.pipe(res);
  } catch (err) {
    console.error("Error retrieving file:", err);
    res.status(500).json({ message: err.message });
  }
});



// ---------------------------
// Resolve Help Request -> Notify user + Delete help + Files
// ---------------------------
router.put("/resolve/:id", async (req, res) => {
  try {
    const help = await HelpRequest.findById(req.params.id);
    if (!help) return res.status(404).json({ error: "Help not found" });

    const gfs = req.app.get("gfs");
    if (gfs && help.attachments.length > 0) {
      for (const att of help.attachments) {
        try {
          await gfs.delete(new mongoose.Types.ObjectId(att.fileId));

        } catch (e) {
          console.warn("File already deleted or not found:", att.fileId);
        }
      }
    }

    const notif = new Notification({
      userId: help.userId,
      helpId: help._id,
      message: `Your help request "${help.subject}" has been resolved.`,
    });
    await notif.save();

    await HelpRequest.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: "Resolved and deleted", notification: notif });
  } catch (err) {
    console.error("Error resolving help:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;