const express = require('express');
const multer = require('multer');
const Grievance = require('../models/Grievance');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/grievances/',
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Submit grievance
router.post('/submit', authMiddleware, upload.array('attachments', 5), async (req, res) => {
  try {
    const { subjectId, title, description } = req.body;
    const studentId = req.user.userId;

    const attachments = req.files ? req.files.map(file => file.filename) : [];

    const grievance = new Grievance({
      studentId,
      subjectId,
      title,
      description,
      attachments
    });

    await grievance.save();

    // Emit real-time notification
    req.io.emit('grievance-submitted', {
      grievanceId: grievance._id,
      studentId,
      subjectId,
      title
    });

    res.json({
      message: 'Grievance submitted successfully',
      grievance
    });

  } catch (error) {
    console.error('Submit grievance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get my grievances (for students)
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const studentId = req.user.userId;

    const grievances = await Grievance.find({ studentId })
      .populate('subjectId', 'name code')
      .populate('reviewedBy', 'teacherName')
      .sort({ createdAt: -1 });

    res.json(grievances);

  } catch (error) {
    console.error('Get my grievances error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get all grievances (for teachers/admin)
router.get('/all', authMiddleware, async (req, res) => {
  try {
    const { status, subjectId } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (subjectId) filter.subjectId = subjectId;

    const grievances = await Grievance.find(filter)
      .populate('studentId', 'name studentId email')
      .populate('subjectId', 'name code')
      .populate('reviewedBy', 'teacherName')
      .sort({ createdAt: -1 });

    res.json(grievances);

  } catch (error) {
    console.error('Get all grievances error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update grievance status
router.put('/:grievanceId/status', authMiddleware, async (req, res) => {
  try {
    const { grievanceId } = req.params;
    const { status, response } = req.body;
    const reviewedBy = req.user.userId;

    const grievance = await Grievance.findByIdAndUpdate(
      grievanceId,
      {
        status,
        response,
        reviewedBy,
        updatedAt: (() => {
          const currentDate = new Date();
          const day = currentDate.getDate().toString().padStart(2, "0");
          const month = (currentDate.getMonth() + 1).toString().padStart(2, "0");
          const year = currentDate.getFullYear();
          return `${day}/${month}/${year}`;
        })()
      },
      { new: true }
    ).populate('studentId', 'name studentId email');

    // Emit real-time status update
    req.io.emit('grievance-status', {
      grievanceId,
      status,
      studentId: grievance.studentId._id
    });

    res.json({
      message: 'Grievance status updated successfully',
      grievance
    });

  } catch (error) {
    console.error('Update grievance status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get grievance by ID
router.get('/:grievanceId', authMiddleware, async (req, res) => {
  try {
    const { grievanceId } = req.params;

    const grievance = await Grievance.findById(grievanceId)
      .populate('studentId', 'name studentId email')
      .populate('subjectId', 'name code')
      .populate('reviewedBy', 'teacherName');

    if (!grievance) {
      return res.status(404).json({ message: 'Grievance not found' });
    }

    res.json(grievance);

  } catch (error) {
    console.error('Get grievance error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;