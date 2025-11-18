import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    helpId: { type: mongoose.Schema.Types.ObjectId, ref: "HelpRequest" },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
  },
  { timestamps: true } // ✅ This is crucial
);

export default mongoose.model("Notification", notificationSchema);