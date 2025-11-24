const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Admin = require("../models/Admin");
const Teacher = require("../models/Teacher");
const Student = require("../models/Student");

const router = express.Router();

// Login route
router.post("/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    let user;
    let userIdField;

    switch (role) {
      case "admin":
        user = await Admin.findOne({ adminId: email });
        userIdField = "adminId";
        break;
      case "teacher":
        user = await Teacher.findOne({ teacherEmail: email });
        userIdField = "teacherEmail";
        break;
      case "student":
        user = await Student.findOne({ email });
        userIdField = "email";
        break;
      default:
        return res.status(400).json({ message: "Invalid role" });
    }

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Check password
    let passwordField;
    switch (role) {
      case "admin":
        passwordField = "adminPassword";
        break;
      case "teacher":
        passwordField = "teacherPassword";
        break;
      case "student":
        passwordField = "password";
        break;
    }

    const isMatch = await bcrypt.compare(password, user[passwordField]);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // Generate JWT
    const token = jwt.sign(
      {
        userId: user._id,
        role,
        email: user[userIdField],
      },
      process.env.JWT_SECRET || "fallback_secret",
      { expiresIn: "24h" }
    );

    // Set httpOnly cookie
    // res.cookie('token', token, {
    //   httpOnly: true,
    //   secure: process.env.NODE_ENV === 'production',
    //   sameSite: 'strict',
    //   maxAge: 24 * 60 * 60 * 1000 // 24 hours
    // });

    res.cookie("token", token, {
      httpOnly: true,
      secure: true, // must be true for HTTPS
      sameSite: "none", // <-- allow cross-site cookies
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });

    res.json({
      message: "Login successful",
      user: {
        id: user._id,
        role,
        name:
          role === "admin"
            ? user.adminName
            : role === "teacher"
            ? user.teacherName
            : user.name,
        email: user[userIdField],
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Logout route
router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out successfully" });
});

// Verify token route
router.get("/verify", async (req, res) => {
  try {
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "fallback_secret"
    );

    let user;
    switch (decoded.role) {
      case "admin":
        user = await Admin.findById(decoded.userId);
        break;
      case "teacher":
        user = await Teacher.findById(decoded.userId);
        break;
      case "student":
        user = await Student.findById(decoded.userId);
        break;
    }

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    res.json({
      user: {
        id: user._id,
        role: decoded.role,
        name:
          decoded.role === "admin"
            ? user.adminName
            : decoded.role === "teacher"
            ? user.teacherName
            : user.name,
        email: decoded.email,
      },
    });
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
});

module.exports = router;
