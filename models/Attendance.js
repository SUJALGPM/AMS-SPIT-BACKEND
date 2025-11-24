const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
  },
  subjectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Subject",
    required: true,
  },
  type: {
    type: String,
    enum: ["Theory", "Practical"],
    required: true,
  },
  // Summary data: total lectures conducted and attended
  totalConducted: {
    type: Number,
    required: true,
    default: 0,
  },
  totalAttended: {
    type: Number,
    required: true,
    default: 0,
  },
  percentage: {
    type: Number,
    required: true,
    default: 0,
  },
  // Period information (e.g., "Aug-25 to Oct-25")
  period: {
    type: String,
    default: null,
  },
  // Division and batch for practical subjects
  division: {
    type: String,
    enum: ["A", "B", "C", "D"],
    default: null,
  },
  batch: {
    type: String,
    default: null,
  },
  recordedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Teacher",
    required: true,
  },
  // Keep date fields for tracking when attendance was recorded
  createdAtDate: {
    type: String,
    default: () => {
      const currentDate = new Date();
      const day = currentDate.getDate().toString().padStart(2, "0");
      const month = (currentDate.getMonth() + 1).toString().padStart(2, "0");
      const year = currentDate.getFullYear();
      return `${day}/${month}/${year}`;
    },
  },
  createdAtTime: {
    type: String,
    default: () => {
      const currentTime = new Date();
      const hours = currentTime.getHours().toString().padStart(2, "0");
      const minutes = currentTime.getMinutes().toString().padStart(2, "0");
      const seconds = currentTime.getSeconds().toString().padStart(2, "0");
      return `${hours}:${minutes}:${seconds}`;
    },
  },
  // Timestamp for sorting
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  // Ensure one record per student-subject-type combination
  // If same period is uploaded again, it will update the existing record
});

// Compound index to ensure uniqueness per student-subject-type-period
// Note: MongoDB treats null as distinct, so we use sparse index to allow multiple null periods
// But we'll handle uniqueness in application logic for better control
attendanceSchema.index({ studentId: 1, subjectId: 1, type: 1, period: 1 }, { 
  unique: true,
  sparse: true,
  partialFilterExpression: { period: { $ne: null } }
});

module.exports = mongoose.model('Attendance', attendanceSchema);