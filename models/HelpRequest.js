import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema({
  filename: String,
  fileId: String, // GridFS file _id
  contentType: String,
});

const helpRequestSchema = new mongoose.Schema({
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: false },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
  to: String,
  from: String,
  subject: String,
  message: String,
  attachments: [attachmentSchema],
  status: { type: String, default: "open" },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("HelpRequest", helpRequestSchema);