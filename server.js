require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'submissions.json');
const PROJECTS_FILE = path.join(__dirname, 'projects.json');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]');
if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, '[]');

function readProjects() {
  return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
}
function writeProjects(data) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(data, null, 2));
}

function readSubmissions() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveSubmission(data) {
  const submissions = readSubmissions();
  submissions.unshift({ id: Date.now(), ...data, date: new Date().toISOString() });
  fs.writeFileSync(DB_FILE, JSON.stringify(submissions, null, 2));
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.post('/api/contact', async (req, res) => {
  const { name, email, projectType, budget, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  saveSubmission({ name, email, projectType, budget, message });

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `New Proposal from ${name}`,
      html: `
        <h2>New Contact Submission</h2>
        <p><b>Name:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Project Type:</b> ${projectType}</p>
        <p><b>Budget:</b> ${budget}</p>
        <p><b>Message:</b><br>${message}</p>
      `
    });
  } catch (e) {
    console.error('Email error:', e.message);
    // Still return success — submission was saved
  }

  res.json({ success: true, message: 'Proposal received!' });
});

app.get('/api/submissions', adminAuth, (req, res) => {
  res.json(readSubmissions());
});

// Auth middleware for admin routes
function adminAuth(req, res, next) {
  const secret = req.query.secret || req.body.secret;
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/projects', (req, res) => res.json(readProjects()));

app.post('/api/projects', adminAuth, (req, res) => {
  const { title, description, tags, imageUrl, link } = req.body;
  if (!title || !description) return res.status(400).json({ error: 'Title and description are required.' });
  const projects = readProjects();
  const project = { id: Date.now(), title, description, tags: tags || [], imageUrl: imageUrl || '', link: link || '' };
  projects.unshift(project);
  writeProjects(projects);
  res.json(project);
});

app.put('/api/projects/:id', adminAuth, (req, res) => {
  const projects = readProjects();
  const idx = projects.findIndex(p => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found.' });
  projects[idx] = { ...projects[idx], ...req.body, id: projects[idx].id };
  writeProjects(projects);
  res.json(projects[idx]);
});

app.delete('/api/projects/:id', adminAuth, (req, res) => {
  const projects = readProjects().filter(p => p.id !== Number(req.params.id));
  writeProjects(projects);
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
