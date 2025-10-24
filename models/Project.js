import mongoose from "mongoose";

const subModelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  fileId: { type: mongoose.Schema.Types.ObjectId }, // reference to GridFS file
  fileName: { type: String },
  contentType: { type: String }, 
});

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    modelName: { type: String },
    modelFileId: { type: mongoose.Schema.Types.ObjectId }, // GridFS file ID
    modelFileName: { type: String },
     modelFileContentType: { type: String }, // ← store MIME type for main model
    subModels: [subModelSchema],
      assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // ← important
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model("Project", projectSchema);