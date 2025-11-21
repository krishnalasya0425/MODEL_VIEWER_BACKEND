import mongoose from "mongoose";

const buildSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  executablePath: { type: String, required: true },
  isMain: { type: Boolean, default: false },
  category: {
    type: String,
    enum: ["simulators", "vehicles", "weapons"],
    required: true
  },
  version: { type: String, default: "1.0.0" },
  createdAt: { type: Date, default: Date.now }
});

const subModelSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  fileId: { type: mongoose.Schema.Types.ObjectId },
  fileName: { type: String },
  contentType: { type: String },
});

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    modelName: { type: String },
    modelFileId: { type: mongoose.Schema.Types.ObjectId }, 
    modelFileName: { type: String },
    category: {
      type: String,
      enum: ["simulators", "vehicles", "weapons"],
      required: true
    },
    modelFileContentType: { type: String },
    builds: [buildSchema],
    subModels: [subModelSchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

projectSchema.index({ "builds.isMain": 1 });

export default mongoose.model("Project", projectSchema);